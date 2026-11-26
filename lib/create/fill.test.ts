import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/presets";
import { SignatureDocSchema, type Block } from "@/lib/schema/document";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { envSignatureLimit, parseLimit } from "@/lib/signature-limit";
import { EMPTY_DETAILS, applyDetails, applyDetailsPreview, applyExtras, applyImages, ensureIdentity, extractDetails, extractExtras, extraFields, imageSlots, patchDetails, socialUrl, toHttps, validateDetails, validateExtras, type Details } from "./fill";

const jane = { ...EMPTY_DETAILS, name: "Jane Cooper", title: "Head of Sales", company: "Acme", phone: "+1 555 0100", email: "jane@acme.com", website: "acme.com", linkedin: "janecooper", twitter: "@jane" };

function walk(blocks: Block[], out: Block[] = []): Block[] {
  for (const b of blocks) {
    out.push(b);
    if (b.type === "row") for (const c of b.columns) walk(c.blocks, out);
  }
  return out;
}

describe("ensureIdentity (a name and title written as plain text still get form fields)", () => {
  const text = (t: string, extra: object = {}) => ({ type: "text", text: t, variant: "body", ...extra });
  const textual = () => SignatureDocSchema.parse({ ...PRESETS[0].doc, blocks: [{ type: "row", columns: [{ blocks: [{ type: "avatar", src: "https://placehold.co/160x160.png", size: 96 }] }, { blocks: [text("TUIDER ES\nJOSSEN", { style: { textTransform: "uppercase" } }), text("Team leader"), { type: "social", links: [{ network: "instagram", url: "https://www.instagram.com/" }] }] }] }] });

  it("turns the first text block into the name and the next one into the title, keeping its style and place", () => {
    const doc = ensureIdentity(textual());
    expect(extractDetails(doc)).toMatchObject({ name: "TUIDER ES JOSSEN", title: "Team leader" });
    const id = walk(doc.blocks).find((b) => b.type === "identity");
    expect(id).toMatchObject({ style: { textTransform: "uppercase" } });
    expect(walk(doc.blocks).filter((b) => b.type === "text")).toHaveLength(0);
    expect(walk(doc.blocks).map((b) => b.type)).toEqual(["row", "avatar", "identity", "social"]);
    expect(SignatureDocSchema.safeParse(doc).success).toBe(true);
  });

  it("leaves a design that already has an identity block exactly as it is", () => {
    const withId = SignatureDocSchema.parse({ ...PRESETS[0].doc, blocks: [{ type: "identity", name: "Jane" }, text("A tagline")] });
    expect(ensureIdentity(withId)).toBe(withId);
  });
});

describe("every line of an AI design gets a form field of its own", () => {
  const line = (icon: string, text: string) => ({ type: "icontext", icon, text, size: 16 });
  const ai = () =>
    SignatureDocSchema.parse({
      ...PRESETS[0].doc,
      blocks: [
        { type: "identity", name: "Tuider Es Jossen", title: "Team leader" },
        { type: "row", columns: [{ blocks: [line("mail", "email@example.com"), line("globe", "example.com"), line("clock", "Mon-Fri 9-5")] }, { blocks: [line("phone", "+123456789"), line("phone", "+987654321"), line("pin", "21B Street, California"), { type: "text", text: "Award winner", variant: "body" }] }] },
      ],
    });
  const field = (doc: ReturnType<typeof ai>, label: string) => extraFields(doc).find((x) => x.label === label)!;

  it("lists a field per line, labelled and typed by its icon, in reading order, even for repeats and unusual icons", () => {
    expect(extraFields(ai()).map((x) => [x.label, x.kind])).toEqual([
      ["Email", "email"], ["Website", "website"], ["Opening hours", "text"],
      ["Phone", "phone"], ["Phone 2", "phone"], ["Address", "address"], ["Text line", "text"],
    ]);
    expect(Object.values(extractExtras(ai()))).toEqual(["email@example.com", "example.com", "Mon-Fri 9-5", "+123456789", "+987654321", "21B Street, California", "Award winner"]);
  });

  it("writes what was typed into exactly that line, linking it by kind and leaving every other line alone", () => {
    const doc = ai();
    const out = applyExtras(doc, { ...extractExtras(doc), [field(doc, "Email").key]: "jane@acme.com", [field(doc, "Phone 2").key]: "+44 20 7946 0000", [field(doc, "Website").key]: "https://acme.com/", [field(doc, "Opening hours").key]: "By appointment" });
    const lines = walk(out.blocks).filter((b): b is Extract<Block, { type: "icontext" }> => b.type === "icontext");
    expect(lines.map((l) => l.text)).toEqual(["jane@acme.com", "acme.com", "By appointment", "+123456789", "+44 20 7946 0000", "21B Street, California"]);
    expect([lines[0].href, lines[1].href, lines[2].href, lines[3].href, lines[4].href]).toEqual(["mailto:jane@acme.com", "https://acme.com/", undefined, "tel:+123456789", "tel:+442079460000"]);
    expect(SignatureDocSchema.safeParse(out).success).toBe(true);
  });

  it("an emptied line is hidden and comes back when typed into again; a text block follows the same rule", () => {
    const doc = ai();
    const key = field(doc, "Phone 2").key;
    const textKey = field(doc, "Text line").key;
    const hidden = applyExtras(doc, { ...extractExtras(doc), [key]: "", [textKey]: "" });
    expect(extractExtras(hidden)[key]).toBe("");
    expect(walk(hidden.blocks).filter((b) => "hidden" in b && b.hidden).map((b) => b.type)).toEqual(["icontext", "text"]);
    const back = applyExtras(hidden, { ...extractExtras(hidden), [key]: "+1 555 0100", [textKey]: "New tagline" });
    expect(walk(back.blocks).some((b) => "hidden" in b && b.hidden)).toBe(false);
    expect(extractExtras(back)[textKey]).toBe("New tagline");
  });

  it("checks emails and web addresses by the line's kind and ignores the rest", () => {
    const doc = ai();
    const bad = validateExtras(doc, { [field(doc, "Email").key]: "nope", [field(doc, "Website").key]: "not a site", [field(doc, "Opening hours").key]: "anything goes", [field(doc, "Address").key]: "1 Road" });
    expect(Object.keys(bad).sort()).toEqual([field(doc, "Email").key, field(doc, "Website").key].sort());
    expect(validateExtras(doc, extractExtras(doc))).toEqual({});
  });

  it("the fixed detail fields no longer take over these lines, so two phone lines never become the same number", () => {
    const doc = ai();
    const out = patchDetails(doc, { ...EMPTY_DETAILS, ...extractDetails(doc), phone: "+1 555 0100", email: "x@y.co" });
    expect(walk(out.blocks).filter((b) => b.type === "icontext").map((b) => (b as { text: string }).text)).toContain("+987654321");
    expect(JSON.stringify(out)).not.toContain("x@y.co");
  });
});

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
    ["everything filled", { ...EMPTY_DETAILS, name: "Zed Quill", title: "Chief Quillmaker", company: "Quill & Co", phone: "+44 20 7946 0000", email: "zed@quill.example", website: "quill.example", address: "9 Ink Lane, Leeds", linkedin: "zedquill", twitter: "@zedquill", instagram: "zedquill", facebook: "zedquill", youtube: "zedquill", github: "zedquill", note: "Quills by appointment only", buttonLabel: "Order a quill", buttonUrl: "quill.example/order" }],
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

describe("applyDetailsPreview", () => {
  it("keeps the template's sample for empty fields and replaces only what was typed", () => {
    for (const p of PRESETS) {
      const sample = walk(p.doc.blocks).find((b) => b.type === "identity");
      const empty = applyDetailsPreview(p.doc, EMPTY_DETAILS);
      expect(walk(empty.blocks).find((b) => b.type === "identity"), p.id).toMatchObject({ name: sample && sample.type === "identity" ? sample.name : "Your name" });
      const typed = applyDetailsPreview(p.doc, { ...EMPTY_DETAILS, name: "Sam" });
      expect(walk(typed.blocks).find((b) => b.type === "identity"), p.id).toMatchObject({ name: "Sam" });
      expect(SignatureDocSchema.safeParse(typed).success, p.id).toBe(true);
    }
  });

  it("ignores a half-typed email instead of breaking the preview", () => {
    const doc = applyDetailsPreview(PRESETS[0].doc, { ...EMPTY_DETAILS, name: "Sam", email: "sam@" });
    expect(SignatureDocSchema.safeParse(doc).success).toBe(true);
  });
});

describe("image slots", () => {
  const url = "https://cdn.example.com/me.png";

  it("puts an uploaded photo in its slot, set to fill the frame, and leaves the other slots alone", () => {
    const p = PRESETS.find((x) => imageSlots(x.doc).some((s) => s.kind === "avatar"))!;
    const slot = imageSlots(p.doc).find((s) => s.kind === "avatar")!;
    const out = applyDetails(applyImages(p.doc, { [slot.key]: { url } }), jane);
    const avatars = walk(out.blocks).filter((b) => b.type === "avatar");
    expect(avatars.some((b) => b.type === "avatar" && b.src === url && b.fit === "cover")).toBe(true);
    expect(SignatureDocSchema.safeParse(out).success).toBe(true);
    expect(renderToEmailHtml(out)).toContain("object-fit:cover");
    expect(applyImages(p.doc, {})).toBe(p.doc);
  });

  it("keeps a banner only when the person added one, sized to the picture's own shape", () => {
    const p = PRESETS.find((x) => imageSlots(x.doc).some((s) => s.kind === "banner"))!;
    const slot = imageSlots(p.doc).find((s) => s.kind === "banner")!;
    expect(walk(applyDetails(p.doc, jane).blocks).some((b) => b.type === "banner")).toBe(false); // the template's sample is dropped
    const out = applyDetails(applyImages(p.doc, { [slot.key]: { url, width: 1200, height: 300 } }), jane);
    const banner = walk(out.blocks).find((b) => b.type === "banner");
    expect(banner).toMatchObject({ src: url, width: 600, height: 150 });
    expect(SignatureDocSchema.safeParse(out).success).toBe(true);
  });

  it("does not add object-fit unless a fit was chosen", () => {
    expect(renderToEmailHtml(applyDetails(PRESETS[0].doc, jane))).not.toContain("object-fit");
  });

  it("carries a photo to another template's photo slot even when the banners differ", () => {
    const withBanner = PRESETS.find((x) => imageSlots(x.doc).some((s) => s.kind === "banner") && imageSlots(x.doc).some((s) => s.kind === "avatar"))!;
    const photoOnly = PRESETS.find((x) => imageSlots(x.doc).some((s) => s.kind === "avatar") && !imageSlots(x.doc).some((s) => s.kind === "banner"))!;
    const saved = { avatar0: { url } }; // what the studio stores after one upload
    for (const p of [withBanner, photoOnly]) {
      const avatars = walk(applyImages(p.doc, saved).blocks).filter((b) => b.type === "avatar");
      expect(avatars.some((b) => b.type === "avatar" && b.src === url), p.id).toBe(true);
      expect(walk(applyImages(p.doc, saved).blocks).some((b) => b.type === "banner" && b.src === url), p.id).toBe(false);
    }
  });
});

describe("coming back from the advanced editor", () => {
  const base = PRESETS.find((p) => walk(p.doc.blocks).some((b) => b.type === "identity") && walk(p.doc.blocks).some((b) => b.type === "contact") && walk(p.doc.blocks).some((b) => b.type === "social"))!;

  it("reads the form fields back out of an edited design", () => {
    const edited = applyDetails(base.doc, jane);
    expect(extractDetails(edited)).toMatchObject({ name: "Jane Cooper", title: "Head of Sales", company: "Acme", phone: "+1 555 0100", email: "jane@acme.com" });
    expect(extractDetails(edited).linkedin).toContain("linkedin.com/in/janecooper");
  });

  it("never leaves a form field undefined, even when the design has no value for it", () => {
    // A design with only a name: everything else is absent, and the merged form state must still be all strings.
    const bare = { ...base.doc, blocks: [{ type: "identity" as const, name: "Sam" }] };
    const merged = { ...EMPTY_DETAILS, ...extractDetails(bare) };
    for (const v of Object.values(merged)) expect(typeof v).toBe("string");
    expect(() => patchDetails(bare, merged)).not.toThrow();
    for (const p of PRESETS) {
      const m = { ...EMPTY_DETAILS, ...extractDetails(p.doc) };
      for (const v of Object.values(m)) expect(typeof v, p.id).toBe("string");
      expect(() => patchDetails(p.doc, m), p.id).not.toThrow();
    }
  });

  it("patches only the fields the form covers and keeps everything else they did in the editor", () => {
    const edited = { ...applyDetails(base.doc, jane), blocks: [...applyDetails(base.doc, jane).blocks, { type: "text" as const, text: "Added in the editor" } as Block] };
    const out = patchDetails(edited, { ...jane, name: "Sam Lee", phone: "" });
    const all = walk(out.blocks);
    expect(all.find((b) => b.type === "identity")).toMatchObject({ name: "Sam Lee", title: "Head of Sales" });
    expect(all.find((b) => b.type === "contact")).toMatchObject({ email: "jane@acme.com", phone: undefined });
    expect(all.some((b) => b.type === "text")).toBe(true); // their extra block survives
    expect(out.theme).toEqual(edited.theme); // and so does their styling
    expect(SignatureDocSchema.safeParse(out).success).toBe(true);
  });

  it("drops a link when its field is cleared but keeps networks the form has no field for", () => {
    const doc = applyDetails(base.doc, jane);
    const withTiktok = { ...doc, blocks: doc.blocks.map((b) => (b.type === "social" ? { ...b, links: [...b.links, { network: "tiktok" as const, url: "https://www.tiktok.com/@jane" }] } : b)) };
    const out = patchDetails(withTiktok, { ...jane, linkedin: "" });
    const links = walk(out.blocks).flatMap((b) => (b.type === "social" ? b.links : []));
    expect(links.map((l) => l.network)).toContain("tiktok");
    expect(links.map((l) => l.network)).not.toContain("linkedin");
    expect(links.map((l) => l.network)).toContain("twitter");
  });

  it("keeps a half-typed email as it was instead of breaking the design", () => {
    const doc = applyDetails(base.doc, jane);
    const out = patchDetails(doc, { ...jane, email: "jane@" });
    expect(walk(out.blocks).find((b) => b.type === "contact")).toMatchObject({ email: "jane@acme.com" });
  });
});
