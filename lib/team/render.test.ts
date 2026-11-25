import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/presets";
import type { SignatureDoc } from "@/lib/schema/document";
import { checkEditedDoc, checkValues, diffDocs } from "./brand-lock";
import { buildDoc, renderForPerson, type PersonData } from "./render";
import { defaultSpec, lockableFields, validateSpec, type TemplateSpec } from "./template";

const DOC: SignatureDoc = {
  version: 1,
  template_id: "classic",
  theme: { primary: "#1E3A8A", text: "#111827", muted: "#6B7280", bg: "#FFFFFF", accent2: "#F4C542", font: "Arial", spacing: "normal" },
  blocks: [
    { type: "avatar", src: "https://cdn.example.com/a.png", alt: "", shape: "circle", size: 80 },
    { type: "identity", name: "Template Name", title: "Template Title", company: "Acme Corp" },
    { type: "contact", phone: "+1 000 000", email: "template@acme.com", website: "acme.com" },
    { type: "banner", src: "https://cdn.example.com/b.png", alt: "Sale", href: "https://acme.com/sale", width: 400, height: 100 },
    { type: "disclaimer", text: "Confidential." },
  ],
};
const PERSON: PersonData = { email: "ann@acme.com", full_name: "Ann Lee", title: "CTO", phone: "+44 20 7946 0000", department: "Eng", custom: { badge: "7" } };
const spec = (over: Partial<TemplateSpec> = {}): TemplateSpec => ({
  doc: DOC,
  lock: { editable: ["1.title", "2.phone"] },
  field_map: { "1.name": "full_name", "1.title": "title", "2.phone": "phone", "2.email": "email" },
  ...over,
});

describe("buildDoc", () => {
  it("fills mapped fields from the directory and keeps locked content from the template", () => {
    const r = buildDoc(spec(), PERSON);
    if (!r.ok) throw new Error(r.error);
    const [, id, contact, banner, disclaimer] = r.doc.blocks as never[] as Record<string, unknown>[];
    expect(id).toMatchObject({ name: "Ann Lee", title: "CTO", company: "Acme Corp" });
    expect(contact).toMatchObject({ phone: "+44 20 7946 0000", email: "ann@acme.com", website: "acme.com" });
    expect(banner.src).toBe("https://cdn.example.com/b.png");
    expect(disclaimer.text).toBe("Confidential.");
    expect(r.doc.theme).toEqual(DOC.theme);
  });

  it("lets the employee override only unlocked fields", () => {
    const r = buildDoc(spec(), PERSON, { "1.title": "Chief Wizard" });
    expect(r.ok && (r.doc.blocks[1] as { title?: string }).title).toBe("Chief Wizard");
    const locked = buildDoc(spec(), PERSON, { "1.company": "Evil" });
    expect(locked.ok).toBe(false);
  });

  it("removes an optional field when the directory value is empty (no placeholder phone leaks)", () => {
    const r = buildDoc(spec(), { ...PERSON, phone: "" });
    expect(r.ok && (r.doc.blocks[2] as { phone?: string }).phone).toBeUndefined();
    const cleared = buildDoc(spec(), PERSON, { "2.phone": "" });
    expect(cleared.ok && (cleared.doc.blocks[2] as { phone?: string }).phone).toBeUndefined();
  });

  it("fails clearly when the name is missing or a value breaks the schema", () => {
    expect(buildDoc(spec(), { ...PERSON, full_name: "" })).toMatchObject({ ok: false, error: expect.stringContaining("Name") });
    expect(buildDoc(spec(), { ...PERSON, email: "not an email" })).toMatchObject({ ok: false });
    expect(buildDoc(spec(), { ...PERSON, full_name: "N".repeat(101) })).toMatchObject({ ok: false });
  });

  it("reads custom directory fields", () => {
    const r = buildDoc(spec({ field_map: { "1.title": "custom.badge" } }), PERSON);
    expect(r.ok && (r.doc.blocks[1] as { title?: string }).title).toBe("7");
  });

  it("does not mutate the template", () => {
    const before = JSON.stringify(DOC);
    buildDoc(spec(), PERSON, { "1.title": "x" });
    expect(JSON.stringify(DOC)).toBe(before);
  });
});

describe("renderForPerson uses the real renderer", () => {
  it("produces table HTML with the person's data, escaped, and never takes HTML from the caller", () => {
    const r = renderForPerson(spec(), PERSON, { "1.title": '<img src=x onerror=alert(1)> & "q"' });
    if (!r.ok) throw new Error(r.error);
    expect(r.html).toContain("<table");
    expect(r.html).toContain("Ann Lee");
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).toContain("&lt;img");
    expect(r.html).not.toMatch(/<script|display:\s*flex|display:\s*grid/i);
  });

  it("works for every preset template with default settings", () => {
    for (const p of PRESETS.slice(0, 40)) {
      const d = defaultSpec(p.doc);
      const v = validateSpec({ doc: p.doc, ...d });
      expect(v.ok, p.id).toBe(true);
      const r = renderForPerson({ doc: p.doc, ...d }, PERSON);
      expect(r.ok, p.id).toBe(true);
    }
  });
});

describe("checkValues", () => {
  it("allows unlocked text and rejects everything else", () => {
    expect(checkValues(spec(), { "1.title": "Fine" })).toEqual([]);
    expect(checkValues(spec(), { "1.company": "x" })).toHaveLength(1); // locked
    expect(checkValues(spec(), { "0.src": "https://evil.example/x.png" })[0].key).toBe("0.src");
    expect(checkValues(spec(), { "theme.primary": "#000000" })).toHaveLength(1);
    expect(checkValues(spec(), { "1.title": 5 })[0].message).toMatch(/text/);
    expect(checkValues(spec(), { "1.title": "x".repeat(101) })[0].message).toMatch(/at most 100/);
    expect(checkValues(spec(), { "1.title": "a\nb" })[0].message).toMatch(/not allowed/);
    expect(checkValues(spec(), { "1.title": "a\u0000b" })).toHaveLength(1);
    expect(checkValues(spec(), [])).toHaveLength(1);
    expect(checkValues(spec(), null)).toHaveLength(1);
    expect(checkValues(spec(), JSON.parse('{"__proto__":"x"}'))).toHaveLength(1);
  });
  it("an empty required field is refused", () => {
    expect(checkValues(spec({ lock: { editable: ["1.name"] } }), { "1.name": "  " })[0].message).toMatch(/empty/);
  });
  it("a locked field is locked even if the lock list is empty", () => {
    expect(checkValues(spec({ lock: { editable: [] } }), { "1.title": "x" })).toHaveLength(1);
  });
});

describe("checkEditedDoc and diffDocs", () => {
  const built = () => {
    const r = buildDoc(spec(), PERSON);
    if (!r.ok) throw new Error(r.error);
    return r.doc;
  };
  it("accepts the untouched document and edits to unlocked fields", () => {
    expect(checkEditedDoc(spec(), PERSON, built())).toEqual([]);
    const edited = structuredClone(built());
    (edited.blocks[1] as { title: string }).title = "New title";
    (edited.blocks[2] as { phone: string }).phone = "+1 1";
    expect(checkEditedDoc(spec(), PERSON, edited)).toEqual([]);
  });
  it("rejects every kind of locked change", () => {
    const cases: [string, (d: SignatureDoc) => void][] = [
      ["1.company", (d) => ((d.blocks[1] as { company: string }).company = "Other")],
      ["0.src", (d) => ((d.blocks[0] as { src: string }).src = "https://evil.example/logo.png")],
      ["3.href", (d) => ((d.blocks[3] as { href: string }).href = "https://evil.example")],
      ["4.text", (d) => ((d.blocks[4] as { text: string }).text = "")],
      ["theme.primary", (d) => (d.theme.primary = "#FF0000")],
      ["template_id", (d) => (d.template_id = "minimal")],
      ["blocks", (d) => d.blocks.pop()],
      ["1.name", (d) => ((d.blocks[1] as { name: string }).name = "Someone Else")],
    ];
    for (const [key, mutate] of cases) {
      const d = structuredClone(built());
      mutate(d);
      const v = checkEditedDoc(spec(), PERSON, d);
      expect(v.map((x) => x.key), key).toContain(key);
    }
  });
  it("counts earlier approved edits as the baseline", () => {
    const withTitle = structuredClone(built());
    (withTitle.blocks[1] as { title: string }).title = "Earlier";
    expect(checkEditedDoc(spec(), PERSON, withTitle, { "1.title": "Earlier" })).toEqual([]);
    expect(checkEditedDoc(spec(), PERSON, withTitle)).toEqual([]); // still an unlocked field
    expect(diffDocs(built(), withTitle)).toEqual(["1.title"]);
  });
});

describe("validateSpec", () => {
  it("rejects keys that do not exist or can never be unlocked", () => {
    const base = { doc: DOC, lock: { editable: ["1.title"] }, field_map: { "1.name": "full_name" } };
    expect(validateSpec(base).ok).toBe(true);
    expect(validateSpec({ ...base, lock: { editable: ["0.src"] } })).toMatchObject({ ok: false });
    expect(validateSpec({ ...base, lock: { editable: ["3.href"] } })).toMatchObject({ ok: false });
    expect(validateSpec({ ...base, lock: { editable: ["9.title"] } })).toMatchObject({ ok: false });
    expect(validateSpec({ ...base, lock: { editable: ["1.title", "1.title"] } })).toMatchObject({ ok: false });
    expect(validateSpec({ ...base, field_map: { "1.name": "password" } })).toMatchObject({ ok: false });
    expect(validateSpec({ ...base, field_map: { "1.name": "custom.badge" } }).ok).toBe(true);
    expect(validateSpec({ ...base, doc: { nope: 1 } })).toMatchObject({ ok: false });
  });
  it("lists the fields a document offers", () => {
    expect(lockableFields(DOC).map((f) => f.key)).toEqual(["0.alt", "1.name", "1.title", "1.company", "2.phone", "2.email", "2.website", "2.address", "3.alt", "4.text"]);
  });
});
