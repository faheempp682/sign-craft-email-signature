import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/presets";
import { SignatureDocSchema, type Block } from "@/lib/schema/document";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { envSignatureLimit, parseLimit } from "@/lib/signature-limit";
import { EMPTY_DETAILS, applyDetails, socialUrl, toHttps, validateDetails, type Details } from "./fill";

const jane = { ...EMPTY_DETAILS, name: "Jane Cooper", title: "Head of Sales", company: "Acme", phone: "+1 555 0100", email: "jane@acme.com", website: "acme.com", linkedin: "janecooper", twitter: "@jane" };

function walk(blocks: Block[], out: Block[] = []): Block[] {
  for (const b of blocks) {
    out.push(b);
    if (b.type === "row") for (const c of b.columns) walk(c.blocks, out);
  }
  return out;
}

describe("applyDetails", () => {
  it("fills every template with the person's details and still validates", () => {
    for (const p of PRESETS) {
      const doc = applyDetails(p.doc, jane);
      expect(SignatureDocSchema.safeParse(doc).success, p.id).toBe(true);
      expect(walk(doc.blocks).find((b) => b.type === "identity"), p.id).toMatchObject({ name: "Jane Cooper" });
      expect(renderToEmailHtml(doc), p.id).toMatch(/Jane|JANE/i);
      for (const b of walk(doc.blocks)) if (b.type === "avatar") expect(b.alt, p.id).toBe("Jane Cooper");
    }
  });

  it("replaces the sample identity and contact, and leaves blank fields out", () => {
    const doc = applyDetails(PRESETS[0].doc, { ...EMPTY_DETAILS, name: "Sam", phone: "123" });
    const all = walk(doc.blocks);
    const id = all.find((b) => b.type === "identity");
    const contact = all.find((b) => b.type === "contact");
    expect(id).toMatchObject({ name: "Sam", title: undefined, company: undefined });
    if (contact) expect(contact).toMatchObject({ phone: "123", email: undefined, website: undefined });
  });

  it("hides social blocks when no links were given, instead of keeping sample links", () => {
    const doc = applyDetails(PRESETS[0].doc, { ...EMPTY_DETAILS, name: "Sam" });
    for (const b of walk(doc.blocks)) if (b.type === "social") expect(b).toMatchObject({ links: [], hidden: true });
  });

  it("builds social links from handles or full links", () => {
    const doc = applyDetails(PRESETS[0].doc, jane);
    const links = walk(doc.blocks).flatMap((b) => (b.type === "social" ? b.links : []));
    if (links.length) expect(links.map((l) => l.url)).toEqual(["https://www.linkedin.com/in/janecooper", "https://x.com/jane"]);
  });
});

describe("input cleaning", () => {
  it("normalises web addresses to https", () => {
    expect(toHttps("acme.com")).toBe("https://acme.com/");
    expect(toHttps("http://acme.com/x")).toBe("https://acme.com/x");
    expect(toHttps("nope")).toBe("");
    expect(toHttps("")).toBe("");
  });
  it("accepts a social handle or link", () => {
    expect(socialUrl("@jane", "https://x.com/")).toBe("https://x.com/jane");
    expect(socialUrl("https://www.linkedin.com/in/jc", "https://www.linkedin.com/in/")).toBe("https://www.linkedin.com/in/jc");
    expect(socialUrl("  ", "https://x.com/")).toBe("");
  });
  it("requires only a name, and flags a bad email or website", () => {
    expect(validateDetails(EMPTY_DETAILS)).toEqual({ name: "Enter your name." });
    expect(validateDetails({ ...jane })).toEqual({});
    expect(Object.keys(validateDetails({ ...jane, email: "x", website: "nope" })).sort()).toEqual(["email", "website"]);
  });
});

describe("signature limit setting", () => {
  it("parses whole numbers 1-1000 only", () => {
    expect(parseLimit(5)).toBe(5);
    expect(parseLimit("12")).toBe(12);
    for (const bad of [0, -1, 1001, 2.5, "x", "", null, undefined]) expect(parseLimit(bad)).toBeNull();
  });
  it("defaults to 5, and the environment can change it", () => {
    expect(envSignatureLimit({})).toBe(5);
    expect(envSignatureLimit({ MAX_SIGNATURES_PER_ACCOUNT: "9" })).toBe(9);
    expect(envSignatureLimit({ MAX_SIGNATURES_PER_ACCOUNT: "0" })).toBe(5);
  });
});

/** Every string in a template that belongs to its sample person or sample promo, not to the template's design. */
function sampleStrings(blocks: Block[]): string[] {
  const out: string[] = [];
  const add = (v: unknown) => typeof v === "string" && v.trim().length >= 3 && out.push(v.trim());
  for (const b of walk(blocks)) {
    if (b.type === "identity") [b.name, b.title, b.company].forEach(add);
    if (b.type === "contact") [b.phone, b.email, b.website, b.address].forEach(add);
    if (b.type === "social") b.links.forEach((l) => add(l.url));
    if (b.type === "banner") [b.alt, b.href].forEach(add);
    if (b.type === "button") [b.label, b.href].forEach(add);
    if (b.type === "text") add(b.text);
    if (b.type === "disclaimer") add(b.text);
    if (b.type === "avatar") add(b.alt);
  }
  return out;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

describe("no sample data leaks into a customer's signature (all templates)", () => {
  const cases: [string, Details][] = [
    ["only a name", { ...EMPTY_DETAILS, name: "Zed Quill" }],
    ["every optional field empty except email", { ...EMPTY_DETAILS, name: "Zed Quill", email: "zed@quill.example" }],
    ["everything filled", { name: "Zed Quill", title: "Chief Quillmaker", company: "Quill & Co", phone: "+44 20 7946 0000", email: "zed@quill.example", website: "quill.example", address: "9 Ink Lane, Leeds", linkedin: "zedquill", twitter: "@zedquill", instagram: "zedquill" }],
  ];
  for (const [label, details] of cases) {
    it(`${label}: nothing from the template's sample person or promo is in the HTML`, () => {
      const leaks: string[] = [];
      for (const p of PRESETS) {
        const html = renderToEmailHtml(applyDetails(p.doc, details));
        const mine = new Set(Object.values(details).filter(Boolean));
        for (const sample of sampleStrings(p.doc.blocks)) {
          if (mine.has(sample)) continue;
          if (html.includes(esc(sample)) || html.includes(sample)) leaks.push(`${p.id}: ${sample.slice(0, 50)}`);
        }
      }
      expect(leaks).toEqual([]);
    });
  }

  it("empty phone, email, website and socials leave no empty labels, links or icons behind", () => {
    for (const p of PRESETS) {
      const html = renderToEmailHtml(applyDetails(p.doc, { ...EMPTY_DETAILS, name: "Zed Quill" }));
      expect(html, p.id).not.toMatch(/href="(mailto:|tel:)?"/);
      expect(html, p.id).not.toMatch(/mailto:\s*"/);
      expect(html, p.id).not.toMatch(/linkedin\.com|x\.com|instagram\.com|facebook\.com|github\.com/);
    }
  });

  it("drops the template's own banner, button, text and disclaimer, wherever they sit", () => {
    const kinds = ["banner", "button", "text", "disclaimer"];
    for (const p of PRESETS) {
      const doc = applyDetails(p.doc, jane);
      expect(walk(doc.blocks).filter((b) => kinds.includes(b.type)), p.id).toEqual([]);
    }
    expect(PRESETS.some((p) => walk(p.doc.blocks).some((b) => b.type === "banner"))).toBe(true); // the test is not vacuous
  });
});
