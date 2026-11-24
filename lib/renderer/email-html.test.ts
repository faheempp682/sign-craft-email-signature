import { describe, expect, it } from "vitest";
import { SignatureDocSchema, TEMPLATE_IDS, type SignatureDoc } from "@/lib/schema/document";
import { renderToEmailHtml, safeHttpsUrl } from "./email-html";
import { TEMPLATE_META } from "@/lib/templates";
import classic from "@/templates/classic.json";

const templates = Object.fromEntries(TEMPLATE_META.map((t) => [t.id, t.doc])) as Record<(typeof TEMPLATE_IDS)[number], SignatureDoc>;
const nameOf = (doc: SignatureDoc) => (doc.blocks.find((b) => b.type === "identity") as { name: string }).name;

describe("templates", () => {
  it.each(TEMPLATE_IDS)("%s validates against the schema", (id) => {
    expect(SignatureDocSchema.safeParse(templates[id]).success).toBe(true);
    expect(templates[id].template_id).toBe(id);
  });

  it.each(TEMPLATE_IDS)("%s renders Outlook-safe HTML", (id) => {
    const html = renderToEmailHtml(SignatureDocSchema.parse(templates[id]));
    expect(html).toContain("<table");
    expect(html).toContain(nameOf(templates[id]).split(" ")[0].replace(/'/g, "&#39;"));
    // Banned by email-client rules (PROJECT.md section 12)
    for (const banned of [/display:\s*flex/i, /display:\s*grid/i, /<svg/i, /<script/i, /data:image/i, /background-image/i, /@font-face/i]) {
      expect(html).not.toMatch(banned);
    }
    // Every image has explicit size + alt attribute
    for (const img of html.match(/<img[^>]*>/g) ?? []) {
      expect(img).toMatch(/width="\d+"/);
      expect(img).toMatch(/height="\d+"/);
      expect(img).toMatch(/alt="/);
    }
  });

  it("is deterministic", () => {
    const doc = SignatureDocSchema.parse(classic);
    expect(renderToEmailHtml(doc)).toBe(renderToEmailHtml(doc));
  });
});

describe("security", () => {
  it("escapes HTML in user text", () => {
    const doc = SignatureDocSchema.parse(classic) as SignatureDoc;
    const evil = structuredClone(doc);
    evil.blocks = [{ type: "identity", name: `<img src=x onerror=alert(1)>"`, title: "<b>x</b>" }];
    const html = renderToEmailHtml(evil);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("rejects non-https image/link URLs at the schema", () => {
    for (const src of ["http://x.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      const bad = { ...classic, blocks: [{ type: "banner", src, alt: "" }] };
      expect(SignatureDocSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("safeHttpsUrl blocks dangerous schemes and normalises bare domains", () => {
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("data:text/html,x")).toBeNull();
    expect(safeHttpsUrl("acme.com")).toBe("https://acme.com/");
    expect(safeHttpsUrl("http://acme.com")).toBe("https://acme.com/");
  });

  it("does not emit an unsafe website href", () => {
    const doc = SignatureDocSchema.parse({ ...classic, blocks: [{ type: "contact", website: "javascript:alert(1)" }] });
    expect(renderToEmailHtml(doc)).not.toMatch(/href="javascript:/i);
  });
});

describe("exporter output is locked", () => {
  // Guards the shared exporter: editor work must never change what ships to email clients.
  it.each(TEMPLATE_IDS)("%s output matches the snapshot", (id) => {
    expect(renderToEmailHtml(SignatureDocSchema.parse(templates[id]))).toMatchSnapshot();
  });
});
