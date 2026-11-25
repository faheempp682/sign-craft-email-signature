import { describe, expect, it } from "vitest";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { SignatureDocSchema } from "@/lib/schema/document";
import { GENERATOR_TEMPLATES, buildDoc, defaultInput, validateInput, withHttps, type GeneratorInput } from "./generator";

const filled = (over: Partial<GeneratorInput> = {}): GeneratorInput => ({
  ...defaultInput(),
  name: "Jane Doe",
  title: "Talent Partner",
  company: "Acme <Corp>",
  phone: "+1 555 0100",
  email: "jane@acme.com",
  website: "acme.com",
  ...over,
});

describe("generator", () => {
  it("offers only vetted templates", () => {
    expect(GENERATOR_TEMPLATES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(GENERATOR_TEMPLATES.map((t) => t.collection))).toEqual(new Set(["Essentials"]));
  });

  it("every offered template builds a valid document and email-safe HTML with no hosted sample images", () => {
    for (const t of GENERATOR_TEMPLATES) {
      const r = buildDoc(filled({ templateId: t.id, accent: "#1d4ed8", socials: { ...defaultInput().socials, linkedin: "linkedin.com/in/jane" } }));
      expect(r.ok, t.id).toBe(true);
      if (!r.ok) continue;
      expect(SignatureDocSchema.safeParse(r.doc).success, t.id).toBe(true);
      const html = renderToEmailHtml(r.doc);
      expect(html.toLowerCase(), t.id).toContain("jane");
      expect(html, t.id).not.toContain("placehold.co");
      expect(html, t.id).not.toMatch(/<script|display:\s*flex|display:\s*grid|data:image/i);
    }
  });

  it("escapes what people type", () => {
    const r = buildDoc(filled({ name: '<img src=x onerror=alert(1)>' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(renderToEmailHtml(r.doc)).not.toContain("<img src=x");
  });

  it("applies the accent colour to the theme", () => {
    const r = buildDoc(filled({ accent: "#aa00ff" }));
    expect(r.ok && r.doc.theme.primary).toBe("#aa00ff");
  });

  it("requires a name, rejects bad emails and non-https links", () => {
    expect(validateInput(filled({ name: "  " })).name).toBeTruthy();
    expect(validateInput(filled({ email: "nope" })).email).toBeTruthy();
    expect(validateInput(filled({ website: "http://acme.com" })).website).toMatch(/https/);
    expect(validateInput(filled({ website: "javascript:alert(1)" })).website).toBeTruthy();
    expect(validateInput(filled({ accent: "red" })).accent).toBeTruthy();
    expect(validateInput(filled({ socials: { ...defaultInput().socials, github: "ftp://x.y/z" } })).social_github).toBeTruthy();
    expect(buildDoc(filled({ email: "nope" })).ok).toBe(false);
  });

  it("adds https to bare links but leaves other schemes for validation to reject", () => {
    expect(withHttps("linkedin.com/in/me")).toBe("https://linkedin.com/in/me");
    expect(withHttps("  ")).toBe("");
    expect(withHttps("http://a.b")).toBe("http://a.b");
  });

  it("includes only the social links that were filled in, adding a block if the template has none", () => {
    for (const t of GENERATOR_TEMPLATES) {
      const r = buildDoc(filled({ templateId: t.id, socials: { ...defaultInput().socials, instagram: "instagram.com/jane" } }));
      expect(r.ok, t.id).toBe(true);
      if (!r.ok) continue;
      const soc = r.doc.blocks.find((b) => b.type === "social");
      expect(soc && soc.type === "social" && soc.links).toEqual([{ network: "instagram", url: "https://instagram.com/jane" }]);
    }
  });

  it("drops the social block when there are no links", () => {
    const r = buildDoc(filled());
    expect(r.ok && r.doc.blocks.some((b) => b.type === "social")).toBe(false);
  });

  it("uses a photo only when the person supplies an https link", () => {
    const withPhoto = GENERATOR_TEMPLATES.find((t) => t.doc.blocks.some((b) => b.type === "avatar"))!;
    const none = buildDoc(filled({ templateId: withPhoto.id }));
    expect(none.ok && none.doc.blocks.some((b) => b.type === "avatar")).toBe(false);
    const yes = buildDoc(filled({ templateId: withPhoto.id, photoUrl: "cdn.example.com/me.jpg" }));
    expect(yes.ok && yes.doc.blocks.find((b) => b.type === "avatar")).toMatchObject({ src: "https://cdn.example.com/me.jpg" });
    expect(validateInput(filled({ photoUrl: "http://cdn.example.com/me.jpg" })).photoUrl).toBeTruthy();
  });

  it("refuses an unknown template", () => {
    expect(buildDoc(filled({ templateId: "nope" })).ok).toBe(false);
  });
});
