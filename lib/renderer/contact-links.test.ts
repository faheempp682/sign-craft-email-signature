import { describe, expect, it } from "vitest";
import { SignatureDocSchema, TEMPLATE_IDS, type SignatureDoc } from "@/lib/schema/document";
import { isValidWebsite } from "@/lib/schema/website";
import { renderToEmailHtml } from "./email-html";
import { FIELDS } from "@/lib/editor/blocks";
import { TEMPLATE_META } from "@/lib/templates";

const theme = { primary: "#1D4ED8", text: "#111111" } as SignatureDoc["theme"];
const doc = (contact: Record<string, unknown>, template_id: (typeof TEMPLATE_IDS)[number] = "classic"): unknown => ({
  version: 1,
  template_id,
  theme,
  blocks: [{ type: "identity", name: "Jane Doe" }, { type: "contact", ...contact }],
});
const parse = (contact: Record<string, unknown>, id?: (typeof TEMPLATE_IDS)[number]) => SignatureDocSchema.parse(doc(contact, id));

describe("website validation", () => {
  it.each(["example.com", "www.example.com", "https://example.com", "http://example.com/a?b=1", "modernhome.co.uk", "shop.example.co.uk/path", "münchen.de".replace("ü", "u")])("accepts %s", (w) => {
    expect(isValidWebsite(w)).toBe(true);
  });
  it.each(["www.@modernhome.co.uk", "user@example.com", "http://user:pw@example.com", "example", "localhost", "exa mple.com", "javascript:alert(1)", "ftp://example.com", "-bad.example.com", "example.c", "example..com", ""])("rejects %j", (w) => {
    expect(isValidWebsite(w)).toBe(false);
  });
  it("is enforced by the schema, with a clear message", () => {
    const r = SignatureDocSchema.safeParse(doc({ website: "www.@modernhome.co.uk" }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ["blocks", 1, "website"], message: expect.stringMatching(/valid website/i) });
  });
  it("still accepts a contact block saved before these fields existed", () => {
    expect(() => parse({ phone: "+1 555 0100", email: "a@b.co", website: "example.com", address: "1 Main St" })).not.toThrow();
  });
});

describe("contact links in exported HTML", () => {
  it("keeps tel: and mailto: automatic", () => {
    const html = renderToEmailHtml(parse({ phone: "+44 232 480 485", email: "brigitte@modernhome.co.uk" }));
    expect(html).toContain('href="tel:+44232480485"');
    expect(html).toContain('href="mailto:brigitte@modernhome.co.uk"');
  });
  it("shows friendly website text while linking to the website", () => {
    const html = renderToEmailHtml(parse({ website: "modernhome.co.uk", websiteLabel: "Visit our showroom" }));
    expect(html).toMatch(/<a href="https:\/\/modernhome\.co\.uk\/"[^>]*>Visit our showroom<\/a>/);
    expect(html).not.toMatch(/>modernhome\.co\.uk</);
  });
  it("shows the address itself when no label is set", () => {
    expect(renderToEmailHtml(parse({ website: "https://modernhome.co.uk/" }))).toMatch(/>modernhome\.co\.uk</);
  });
  it("links the address when addressHref is set, otherwise leaves plain text", () => {
    const linked = renderToEmailHtml(parse({ address: "Studio 1, London", addressHref: "https://maps.google.com/?q=studio" }));
    expect(linked).toMatch(/<a href="https:\/\/maps\.google\.com\/\?q=studio"[^>]*>Studio 1, London<\/a>/);
    expect(renderToEmailHtml(parse({ address: "Studio 1, London" }))).not.toContain('href="https://maps');
    expect(SignatureDocSchema.safeParse(doc({ address: "x", addressHref: "http://insecure.example" })).success).toBe(false);
  });
  it("escapes label and address text", () => {
    const html = renderToEmailHtml(parse({ website: "example.com", websiteLabel: '<img src=x onerror="a">' }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("social links inside a contact block", () => {
  const social = [
    { network: "linkedin", url: "https://linkedin.com/in/jane" },
    { network: "instagram", url: "https://instagram.com/jane" },
  ];
  it("renders each link under the contact lines", () => {
    const html = renderToEmailHtml(parse({ email: "a@b.co", social }));
    expect(html).toContain('href="https://linkedin.com/in/jane"');
    expect(html).toContain('href="https://instagram.com/jane"');
    expect(html.indexOf("mailto:a@b.co")).toBeLessThan(html.indexOf("linkedin.com/in/jane"));
  });
  it("supports icon display and every network", () => {
    const all = ["linkedin", "twitter", "instagram", "facebook", "youtube", "github", "tiktok"].map((network) => ({ network, url: `https://${network}.com/x` }));
    const html = renderToEmailHtml(parse({ social: all, socialDisplay: "icon" }));
    expect(html.match(/<img /g)?.length).toBe(7);
  });
  it("renders social on card templates too", () => {
    const card = TEMPLATE_META.find((t) => t.id !== "classic" && t.doc.blocks.some((b) => b.type === "contact"))!;
    const d = structuredClone(card.doc) as SignatureDoc;
    for (const b of d.blocks) if (b.type === "contact") (b as { social?: unknown }).social = social;
    expect(renderToEmailHtml(SignatureDocSchema.parse(d))).toContain('href="https://linkedin.com/in/jane"');
  });
  it("rejects non-https social urls and more than 8 links", () => {
    expect(SignatureDocSchema.safeParse(doc({ social: [{ network: "github", url: "http://github.com/x" }] })).success).toBe(false);
    expect(SignatureDocSchema.safeParse(doc({ social: Array.from({ length: 9 }, () => ({ network: "github", url: "https://github.com/x" })) })).success).toBe(false);
  });
  it("leaves the standalone Social block unchanged", () => {
    const d = SignatureDocSchema.parse({ version: 1, template_id: "classic", theme, blocks: [{ type: "social", links: social }] });
    const html = renderToEmailHtml(d);
    expect(html).toContain("LinkedIn");
    expect(html).toContain("Instagram");
  });
  it("renders nothing extra for contact blocks without social", () => {
    expect(renderToEmailHtml(parse({ email: "a@b.co", social: [] }))).not.toContain("linkedin");
  });
});

describe("editor field specs for Contact", () => {
  it("exposes the new link fields in the content panel", () => {
    const keys = FIELDS.contact.map((f) => f.key);
    expect(keys).toEqual(["phone", "email", "website", "websiteLabel", "address", "addressHref"]);
  });
});
