import { describe, expect, it } from "vitest";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { applyAutofill, planAutofill, type FieldKey } from "./apply-facts";
import type { Facts } from "./autofill";

const doc = (blocks: unknown[] = []): SignatureDoc =>
  SignatureDocSchema.parse({ version: 1, template_id: "classic", theme: { primary: "#1E3A8A", text: "#111827" }, blocks });

const FACTS: Facts = {
  name: "Jane Doe", title: "Designer", company: "Acme", phone: "+1 555 010 2030", email: "jane@acme.com", website: "acme.com", address: "1 Main St",
  social: [{ network: "linkedin", url: "https://linkedin.com/in/janedoe" }],
};
const all = (facts: Facts = FACTS): Set<FieldKey> => new Set(planAutofill(doc(), facts).map((p) => p.key));

describe("planAutofill", () => {
  it("proposes everything for an empty signature, all pre-ticked as safe fills", () => {
    const plan = planAutofill(doc(), FACTS);
    expect(plan.map((p) => p.key)).toEqual(["name", "title", "company", "email", "phone", "website", "address", "social:linkedin"]);
    expect(plan.every((p) => p.mode === "fill" && p.recommended)).toBe(true);
  });

  it("treats starter text as safe to replace", () => {
    const d = doc([{ type: "identity", name: "Your Name", title: "Your title", company: "Your Company" }, { type: "contact", email: "you@example.com", phone: "+1 555 000 0000", website: "yourcompany.com" }]);
    const plan = planAutofill(d, FACTS);
    for (const k of ["name", "title", "company", "email", "phone", "website"]) {
      const p = plan.find((x) => x.key === k)!;
      expect([k, p.mode, p.recommended]).toEqual([k, "fill", true]);
    }
  });

  it("marks anything the user already wrote as a replacement that is NOT pre-ticked", () => {
    const d = doc([{ type: "identity", name: "Janet Real", title: "CEO" }, { type: "contact", email: "janet@real.com" }]);
    const plan = planAutofill(d, FACTS);
    const name = plan.find((p) => p.key === "name")!;
    expect(name).toMatchObject({ mode: "replace", recommended: false, current: "Janet Real", proposed: "Jane Doe" });
    expect(plan.find((p) => p.key === "email")).toMatchObject({ mode: "replace", recommended: false });
    expect(plan.find((p) => p.key === "company")).toMatchObject({ mode: "fill", recommended: true }); // empty field: safe
  });

  it("skips values the signature already has", () => {
    const d = doc([{ type: "identity", name: "jane doe" }, { type: "contact", email: "JANE@acme.com" }]);
    const keys = planAutofill(d, FACTS).map((p) => p.key);
    expect(keys).not.toContain("name");
    expect(keys).not.toContain("email");
  });

  it("treats the editor's bare social placeholder as a safe fill, and a real link as a replacement", () => {
    const bare = doc([{ type: "social", links: [{ network: "linkedin", url: "https://linkedin.com/in/" }] }]);
    expect(planAutofill(bare, FACTS).find((p) => p.key === "social:linkedin")).toMatchObject({ mode: "fill", recommended: true });
    const real = doc([{ type: "social", links: [{ network: "linkedin", url: "https://linkedin.com/in/someoneelse" }] }]);
    expect(planAutofill(real, FACTS).find((p) => p.key === "social:linkedin")).toMatchObject({ mode: "replace", recommended: false });
  });

  it("returns nothing when there is nothing to add", () => {
    expect(planAutofill(doc(), { social: [] })).toEqual([]);
  });
});

describe("applyAutofill", () => {
  it("writes selected facts into the existing blocks and changes nothing else", () => {
    const d = doc([
      { type: "avatar", src: "https://cdn.acme.com/me.png", alt: "Me", shape: "circle", size: 80 },
      { type: "identity", name: "Your Name" },
      { type: "contact" },
      { type: "banner", src: "https://cdn.acme.com/b.png", alt: "b", width: 400, height: 100 },
    ]);
    const r = applyAutofill(d, FACTS, all());
    expect(r.doc.blocks[1]).toMatchObject({ type: "identity", name: "Jane Doe", title: "Designer", company: "Acme" });
    expect(r.doc.blocks[2]).toMatchObject({ type: "contact", email: "jane@acme.com", phone: "+1 555 010 2030", website: "acme.com", address: "1 Main St" });
    expect(r.doc.blocks[0]).toEqual(d.blocks[0]); // image blocks untouched
    expect(r.doc.blocks.map((b) => b.type)).toEqual(["avatar", "identity", "contact", "social", "banner"]); // a Social block was created before the banner
    expect(r.doc.blocks.at(-1)).toEqual(d.blocks[3]);
    expect(r.doc.theme).toEqual(d.theme);
    expect(r.doc.template_id).toBe(d.template_id);
  });

  it("only applies the fields that were ticked", () => {
    const d = doc([{ type: "identity", name: "Janet Real", title: "CEO" }]);
    const r = applyAutofill(d, FACTS, new Set<FieldKey>(["company"]));
    expect(r.doc.blocks[0]).toMatchObject({ name: "Janet Real", title: "CEO", company: "Acme" });
    expect(r.doc.blocks).toHaveLength(1); // no contact block created, nothing ticked for it
  });

  it("creates missing blocks in a sensible place and reports which are new", () => {
    const d = doc([{ type: "avatar", src: "https://cdn.acme.com/me.png", alt: "Me", shape: "circle", size: 80 }, { type: "divider" }]);
    const r = applyAutofill(d, FACTS, all());
    expect(r.doc.blocks.map((b) => b.type)).toEqual(["avatar", "identity", "contact", "social", "divider"]);
    expect(r.order).toEqual([0, null, null, null, 1]);
  });

  it("maps every kept block back to its old index, so the editor can keep ids stable", () => {
    const d = doc([{ type: "identity", name: "Your Name" }, { type: "divider" }, { type: "disclaimer", text: "x" }]);
    const r = applyAutofill(d, FACTS, all());
    expect(r.order.filter((o) => o !== null)).toEqual([0, 1, 2]);
    expect(r.order.length).toBe(r.doc.blocks.length);
  });

  it("puts a new Name block first when the signature has no photo", () => {
    const r = applyAutofill(doc([{ type: "divider" }]), FACTS, new Set<FieldKey>(["name"]));
    expect(r.doc.blocks.map((b) => b.type)).toEqual(["identity", "divider"]);
    expect(r.order).toEqual([null, 0]);
  });

  it("merges social links: replaces the same network, keeps the others", () => {
    const d = doc([{ type: "social", links: [{ network: "github", url: "https://github.com/me" }, { network: "linkedin", url: "https://linkedin.com/in/" }] }]);
    const r = applyAutofill(d, FACTS, new Set<FieldKey>(["social:linkedin"]));
    expect(r.doc.blocks[0]).toMatchObject({ links: [{ network: "github", url: "https://github.com/me" }, { network: "linkedin", url: "https://linkedin.com/in/janedoe" }] });
  });

  it("never exceeds 8 social links or 30 blocks", () => {
    const nets = ["linkedin", "twitter", "facebook", "instagram", "youtube", "github", "tiktok"] as const;
    const existing = nets.map((n) => ({ network: n, url: `https://${n}.com/me` }));
    const facts: Facts = { social: [{ network: "linkedin", url: "https://linkedin.com/in/new" }] };
    const r = applyAutofill(doc([{ type: "social", links: existing }]), facts, new Set<FieldKey>(["social:linkedin"]));
    expect((r.doc.blocks[0] as { links: unknown[] }).links.length).toBeLessThanOrEqual(8);

    const full = doc(Array.from({ length: 30 }, () => ({ type: "divider" })));
    const r2 = applyAutofill(full, FACTS, all());
    expect(r2.doc.blocks.length).toBe(30);
  });

  it("always produces a document that still validates", () => {
    for (const blocks of [[], [{ type: "identity", name: "X" }], [{ type: "contact" }, { type: "social", links: [] }]]) {
      const r = applyAutofill(doc(blocks), FACTS, all());
      expect(SignatureDocSchema.safeParse(r.doc).success).toBe(true);
    }
  });

  it("does not mutate the document it was given", () => {
    const d = doc([{ type: "identity", name: "Your Name" }]);
    const before = JSON.stringify(d);
    applyAutofill(d, FACTS, all());
    expect(JSON.stringify(d)).toBe(before);
  });
});
