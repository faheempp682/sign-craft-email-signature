import { describe, expect, it } from "vitest";
import { decide, diffCrm, diffDirectory, safetyProblem } from "./diff";
import type { DirectoryFetch, ExistingPerson, SourceUser } from "./types";

const person = (o: Partial<ExistingPerson> = {}): ExistingPerson => ({
  id: "p1", email: "ada@x.com", full_name: "Ada Lovelace", first_name: "Ada", last_name: "Lovelace", title: "Engineer", department: "R&D", phone: "", mobile: "", location: "",
  custom: {}, source: "google", external_id: "g1", status: "active", ...o,
});
const user = (o: Partial<SourceUser> = {}): SourceUser => ({
  external_id: "g1", email: "ada@x.com", full_name: "Ada Lovelace", first_name: "Ada", last_name: "Lovelace", title: "Engineer", department: "R&D", phone: "", mobile: "", location: "", status: "active", ...o,
});
const fetched = (users: SourceUser[], extraSeen: string[] = []): DirectoryFetch => ({ users, seenIds: new Set([...users.map((u) => u.external_id), ...extraSeen]), skipped: 0, warnings: [] });
const run = (users: SourceUser[], existing: ExistingPerson[], o: { policy?: Record<string, "source" | "directory">; blank?: boolean; extraSeen?: string[] } = {}) =>
  diffDirectory({ source: "google", fetched: fetched(users, o.extraSeen), existing, policy: o.policy ?? {}, allowBlankOverwrite: o.blank ?? false });

describe("decide: who wins per field", () => {
  it("same value: nothing", () => expect(decide("source", "a", "a", true)).toBeNull());
  it("source wins overwrites a different value", () => expect(decide("source", "new", "old", false)).toBe("new"));
  it("directory wins keeps a typed value", () => expect(decide("directory", "new", "old", false)).toBeNull());
  it("directory wins still fills a blank", () => expect(decide("directory", "new", "", false)).toBe("new"));
  it("a blank source value never erases by default", () => expect(decide("source", "", "typed", false)).toBeNull());
  it("a blank erases only with the option AND source-wins", () => {
    expect(decide("source", "", "typed", true)).toBe("");
    expect(decide("directory", "", "typed", true)).toBeNull();
    expect(decide("source", "", "typed", true, false)).toBeNull(); // a required field (full name) can never be blanked
  });
});

describe("directory diff", () => {
  it("creates, updates, deactivates and counts unchanged", () => {
    const existing = [
      person({ id: "a", email: "ada@x.com", external_id: "g1", title: "Old" }),
      person({ id: "b", email: "bob@x.com", full_name: "Bob", external_id: "g2" }),
      person({ id: "c", email: "gone@x.com", full_name: "Gone", external_id: "g3" }),
    ];
    const { plan, stats } = run([user({ title: "New" }), user({ external_id: "g2", email: "bob@x.com", full_name: "Bob", first_name: "Ada", last_name: "Lovelace", title: "Engineer", department: "R&D" }), user({ external_id: "g4", email: "new@x.com", full_name: "New One" })], existing);
    expect(plan.creates.map((c) => c.email)).toEqual(["new@x.com"]);
    expect(plan.updates.find((u) => u.person_id === "a")?.changes).toEqual([{ field: "title", from: "Old", to: "New" }]);
    expect(plan.deactivates.map((d) => d.person_id)).toEqual(["c"]);
    expect(stats).toMatchObject({ creates: 1, updates: 1, unchanged: 1, deactivates: 1, base: 3 });
  });

  it("never deactivates people from another source, inactive people, or users merely skipped", () => {
    const existing = [
      person({ id: "m", email: "manual@x.com", source: "manual", external_id: null }),
      person({ id: "csv", email: "csv@x.com", source: "csv", external_id: "g9" }),
      person({ id: "ms", email: "ms@x.com", source: "microsoft", external_id: "m1" }),
      person({ id: "off", email: "off@x.com", status: "inactive", external_id: "g8" }),
      person({ id: "skip", email: "skipped@x.com", external_id: "g7" }),
    ];
    const { plan } = run([user({ external_id: "gx", email: "x@x.com", full_name: "X" })], existing, { extraSeen: ["g7"] });
    expect(plan.deactivates).toEqual([]);
  });

  it("an empty source list deactivates everyone it manages (the safety cap, not the diff, is what stops that)", () => {
    const { plan, stats } = run([], [person({ id: "a" }), person({ id: "b", email: "b@x.com", external_id: "g2" })]);
    expect(plan.deactivates).toHaveLength(2);
    expect(safetyProblem("directory", stats, 20)).toMatch(/no users/);
  });

  it("a blank source value keeps the typed value; the option erases it", () => {
    const existing = [person({ phone: "123" })];
    expect(run([user({ phone: "" })], existing).plan.updates).toEqual([]);
    const withBlank = run([user({ phone: "" })], existing, { blank: true });
    expect(withBlank.plan.updates[0].set).toEqual({ phone: "" });
    expect(withBlank.stats.erasures).toBe(1);
  });

  it("per-field policy: directory wins keeps a hand-typed title but fills an empty phone", () => {
    const { plan } = run([user({ title: "From Google", phone: "555" })], [person({ title: "Typed by hand" })], { policy: { title: "directory" } });
    expect(plan.updates[0].set).toEqual({ phone: "555" });
  });

  it("links a manual person to the source by email (source and external id), once", () => {
    const { plan } = run([user({ external_id: "g1" })], [person({ source: "manual", external_id: null })]);
    expect(plan.updates[0].set).toMatchObject({ source: "google", external_id: "g1" });
    // a person already tied to another external id is not re-linked
    const again = run([user({ external_id: "g1" })], [person({ source: "csv", external_id: "hr-7" })]);
    expect(again.plan.updates).toEqual([]);
  });

  it("suspended accounts become inactive, are not created, and come back when re-enabled", () => {
    expect(run([user({ status: "inactive" })], [person()]).plan.updates[0].set).toEqual({ status: "inactive" });
    expect(run([user({ external_id: "n", email: "n@x.com", full_name: "N", status: "inactive" })], []).plan.creates).toEqual([]);
    expect(run([user()], [person({ status: "inactive" })]).plan.updates[0].set).toEqual({ status: "active" });
  });

  it("status policy 'directory' turns automatic (de)activation off", () => {
    const r = run([user({ status: "inactive" })], [person(), person({ id: "z", email: "z@x.com", external_id: "g9" })], { policy: { status: "directory" } });
    expect(r.plan.updates).toEqual([]);
    expect(r.plan.deactivates).toEqual([]);
  });

  it("follows an address change by external id, but not onto someone else's address", () => {
    expect(run([user({ email: "ada.new@x.com" })], [person()]).plan.updates[0].set.email).toBe("ada.new@x.com");
    const clash = run([user({ email: "bob@x.com" })], [person(), person({ id: "b", email: "bob@x.com", source: "manual", external_id: null })]);
    expect(clash.plan.updates.find((u) => u.person_id === "p1")).toBeUndefined();
    expect(clash.plan.warnings.some((w) => /already another person/.test(w.message))).toBe(true);
  });

  it("two source accounts with one email: only the first", () => {
    const { plan } = run([user({ external_id: "a", email: "d@x.com", full_name: "D" }), user({ external_id: "b", email: "D@x.com", full_name: "D2" })], []);
    expect(plan.creates).toHaveLength(1);
    expect(plan.warnings).toHaveLength(1);
  });
});

describe("CRM diff", () => {
  const rec = (m: Record<string, Record<string, string>>) => new Map(Object.entries(m));
  const crm = (records: Map<string, Record<string, string>>, people: ExistingPerson[], o: { policy?: Record<string, "source" | "directory">; blank?: boolean } = {}) =>
    diffCrm({ records, people, policy: o.policy ?? {}, defaultPolicy: "directory", allowBlankOverwrite: o.blank ?? false });

  it("by default fills blanks only; the CRM overwrites only where the admin said so", () => {
    const p = person({ title: "Typed", phone: "" });
    const r = crm(rec({ "ada@x.com": { title: "CRM title", phone: "555" } }), [p]);
    expect(r.plan.updates[0].set).toEqual({ phone: "555" });
    const r2 = crm(rec({ "ada@x.com": { title: "CRM title", phone: "555" } }), [p], { policy: { title: "source" } });
    expect(r2.plan.updates[0].set).toEqual({ title: "CRM title", phone: "555" });
  });

  it("custom fields: set, remove on blank (with the option), and the limit of ten", () => {
    const p = person({ custom: { booking: "old" } });
    const r = crm(rec({ "ada@x.com": { "custom.booking": "https://cal/x" } }), [p], { policy: { "custom.booking": "source" } });
    expect(r.plan.updates[0].custom_set).toEqual({ booking: "https://cal/x" });
    const gone = crm(rec({ "ada@x.com": { "custom.booking": "" } }), [p], { policy: { "custom.booking": "source" }, blank: true });
    expect(gone.plan.updates[0].custom_remove).toEqual(["booking"]);
    expect(gone.stats.erasures).toBe(1);
    const full = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, "v"]));
    const over = crm(rec({ "ada@x.com": { "custom.extra": "v" } }), [person({ custom: full })]);
    expect(over.plan.updates).toEqual([]);
    expect(over.plan.warnings[0].message).toMatch(/at most 10/);
  });

  it("counts people the CRM does not know and ignores inactive people", () => {
    const r = crm(rec({}), [person(), person({ id: "i", email: "i@x.com", status: "inactive" })]);
    expect(r.stats).toMatchObject({ fetched: 0, not_found: 1 });
    expect(safetyProblem("crm", r.stats, 20)).toMatch(/no matching records/);
  });
});

describe("safety cap", () => {
  const stats = (o: object) => ({ fetched: 10, creates: 0, updates: 0, deactivates: 0, unchanged: 0, skipped: 0, erasures: 0, base: 10, ...o });
  it("allows up to the cap and refuses above it", () => {
    expect(safetyProblem("directory", stats({ deactivates: 2 }), 20)).toBeNull();
    expect(safetyProblem("directory", stats({ deactivates: 3 }), 20)).toMatch(/safety cap.*3 of 10/);
    expect(safetyProblem("directory", stats({ deactivates: 3 }), 30)).toBeNull();
  });
  it("applies to CRM erasures", () => expect(safetyProblem("crm", stats({ erasures: 5 }), 20)).toMatch(/erase values/));
});
