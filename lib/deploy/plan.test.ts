import { describe, expect, it, vi } from "vitest";
import { MAX_SIGNATURE_CHARS } from "@/lib/google/gmail";
import { canon, countPlan, decide, fingerprint, pool, signatureHash, withBackoff, type PlanInput } from "./plan";

const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  person: { id: "p1", email: "ann@acme.com", full_name: "Ann", status: "active" },
  version: { id: "v1", template_id: "t1" },
  expectedTemplateId: null,
  render: { ok: true, html: "<table><tr><td>Ann</td></tr></table>" },
  live: { ok: true, signature: "" },
  ...o,
});

describe("decide: one person", () => {
  it("sets a signature when none exists", () => {
    const d = decide(base());
    expect(d).toMatchObject({ action: "set", code: "", has_existing: false, version_id: "v1" });
    expect(d.new_hash).toBe(signatureHash("<table><tr><td>Ann</td></tr></table>"));
    expect(d.expect_hash).toBe(signatureHash(""));
  });
  it("replaces a different existing signature and remembers its hash", () => {
    const d = decide(base({ live: { ok: true, signature: "<p>old</p>" } }));
    expect(d).toMatchObject({ action: "replace", has_existing: true, expect_hash: signatureHash("<p>old</p>") });
  });
  it("is already up to date when the live signature matches (whitespace-insensitive)", () => {
    const d = decide(base({ live: { ok: true, signature: "<table>\n <tr>  <td>Ann</td></tr>\n</table>" } }));
    expect(d).toMatchObject({ action: "skip", code: "already_current" });
  });
  it("skips inactive people before anything else", () => {
    expect(decide(base({ person: { id: "p1", email: "a@b.co", full_name: "A", status: "inactive" } }))).toMatchObject({ action: "skip", code: "inactive" });
  });
  it("skips people without an approved version", () => {
    expect(decide(base({ version: null }))).toMatchObject({ code: "no_version" });
  });
  it("skips a person whose approved template is not the one the rules choose (and when the rules choose none)", () => {
    expect(decide(base({ expectedTemplateId: "t2" }))).toMatchObject({ code: "template_mismatch" });
    expect(decide(base({ expectedTemplateId: "t1" }))).toMatchObject({ action: "set" });
    expect(decide(base({ expectedTemplateId: "none" }))).toMatchObject({ code: "template_mismatch" });
  });
  it("skips a signature that cannot be built", () => {
    expect(decide(base({ render: { ok: false, error: "Name is empty." } }))).toMatchObject({ code: "render_failed" });
    expect(decide(base({ render: null }))).toMatchObject({ code: "render_failed" });
  });
  it("skips a signature over Gmail's size limit, but allows exactly the limit", () => {
    expect(decide(base({ render: { ok: true, html: "x".repeat(MAX_SIGNATURE_CHARS + 1) } }))).toMatchObject({ code: "too_long" });
    expect(decide(base({ render: { ok: true, html: "x".repeat(MAX_SIGNATURE_CHARS) } })).action).toBe("set");
  });
  it("skips when the mailbox could not be read, keeping the reason", () => {
    expect(decide(base({ live: { ok: false, code: "no_mailbox", message: "No mailbox" } }))).toMatchObject({ code: "no_mailbox", reason: "No mailbox" });
    expect(decide(base({ live: { ok: false, code: "cannot_act", message: "x" } }))).toMatchObject({ code: "cannot_act" });
    expect(decide(base({ live: null }))).toMatchObject({ code: "unreadable" });
  });
  it("never produces a write for a skipped person (no hashes to write)", () => {
    const d = decide(base({ version: null }));
    expect(d.new_hash).toBeNull();
  });
});

describe("counts and fingerprint", () => {
  const items = [decide(base()), decide(base({ person: { id: "p2", email: "b@acme.com", full_name: "B", status: "active" }, live: { ok: true, signature: "<p>x</p>" } })), decide(base({ person: { id: "p3", email: "c@acme.com", full_name: "C", status: "active" }, version: null })), decide(base({ person: { id: "p4", email: "d@acme.com", full_name: "D", status: "active" }, live: { ok: true, signature: "<table><tr><td>Ann</td></tr></table>" } }))];
  it("counts what the confirmation text needs", () => {
    expect(countPlan(items)).toEqual({ total: 4, set: 1, replace: 1, actionable: 2, already_current: 1, skipped: 1 });
  });
  it("changes when anything the confirmation depends on changes, and not with order", () => {
    const f = fingerprint("org", items);
    expect(fingerprint("org", [...items].reverse())).toBe(f);
    expect(fingerprint("other", items)).not.toBe(f);
    expect(fingerprint("org", items.slice(1))).not.toBe(f);
    const changedLive = [decide(base({ live: { ok: true, signature: "<p>someone edited</p>" } })), ...items.slice(1)];
    expect(fingerprint("org", changedLive)).not.toBe(f);
    const existing = [decide(base({ live: { ok: true, signature: "<p>first</p>" } })), ...items.slice(1)];
    const existingEdited = [decide(base({ live: { ok: true, signature: "<p>first, then edited</p>" } })), ...items.slice(1)];
    expect(fingerprint("org", existing)).not.toBe(fingerprint("org", existingEdited));
    const newVersion = [decide(base({ version: { id: "v2", template_id: "t1" } })), ...items.slice(1)];
    expect(fingerprint("org", newVersion)).not.toBe(f);
    const newHtml = [decide(base({ render: { ok: true, html: "<p>different</p>" } })), ...items.slice(1)];
    expect(fingerprint("org", newHtml)).not.toBe(f);
  });
});

describe("canon", () => {
  it("collapses whitespace only", () => {
    expect(canon("  <p>a</p>\n  <p>b  c</p> ")).toBe("<p>a</p><p>b c</p>");
  });
});

describe("withBackoff", () => {
  const rate = new Error("rate");
  it("retries with exponential delay and then succeeds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const r = await withBackoff(async () => (++calls < 3 ? Promise.reject(rate) : "ok"), { retryable: () => true, baseMs: 100, sleep: async (ms) => void sleeps.push(ms), random: () => 0 });
    expect(r).toBe("ok");
    expect(sleeps).toEqual([100, 200]);
  });
  it("gives up after the attempts and does not retry non-retryable errors", async () => {
    const fn = vi.fn(async () => Promise.reject(rate));
    await expect(withBackoff(fn, { retryable: () => true, attempts: 3, sleep: async () => {} })).rejects.toBe(rate);
    expect(fn).toHaveBeenCalledTimes(3);
    const fn2 = vi.fn(async () => Promise.reject(rate));
    await expect(withBackoff(fn2, { retryable: () => false, sleep: async () => {} })).rejects.toBe(rate);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

describe("pool", () => {
  it("never runs more than the limit at once and survives a throwing worker", async () => {
    let active = 0;
    let max = 0;
    const out = await pool([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (x === 4) throw new Error("boom");
      return x * 2;
    });
    expect(max).toBe(3);
    expect(out.filter((r) => r.status === "fulfilled")).toHaveLength(6);
    expect(out[3].status).toBe("rejected");
  });
});
