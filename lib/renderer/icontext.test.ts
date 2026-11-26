import { describe, expect, it } from "vitest";
import { SignatureDocSchema, type Block } from "@/lib/schema/document";
import { TEMPLATE_META } from "@/lib/templates";
import { renderToEmailHtml } from "./email-html";
import { emailIconUrl } from "./shared";
import { createBlock } from "@/lib/editor/blocks";
import { sanitizeDoc } from "@/lib/ai/design";
import { createRow } from "@/lib/editor/row-ops";

const base = () => SignatureDocSchema.parse(TEMPLATE_META.find((t) => t.id === "classic")!.doc);
const withBlock = (b: Block) => SignatureDocSchema.parse({ ...base(), blocks: [...base().blocks, b] });

describe("icon + text block", () => {
  it("a new block is schema-valid and renders a badge icon beside the text as nested tables", () => {
    const doc = withBlock({ ...(createBlock("icontext") as Extract<Block, { type: "icontext" }>), text: "Call us" });
    const html = renderToEmailHtml(doc);
    expect(html).toContain(emailIconUrl("phone"));
    expect(html).toContain("Call us");
    expect(html).toContain("border-radius:50%");
    expect(html).not.toMatch(/<svg|data:image|flex|grid/);
  });
  it("uses the user's own icon instead of the built-in one, and the chosen badge colour", () => {
    const own = renderToEmailHtml(withBlock({ type: "icontext", icon: "mail", src: "https://cdn.example.com/i.png", text: "Hi", size: 24 }));
    expect(own).toContain("https://cdn.example.com/i.png");
    expect(own).not.toContain(emailIconUrl("mail"));
    const coloured = renderToEmailHtml(withBlock({ type: "icontext", icon: "star", text: "Hi", size: 20, iconColor: "#FF0000" }));
    expect(coloured).toContain('bgcolor="#FF0000"');
  });
  it("links only with https, mailto or tel; anything else fails validation", () => {
    for (const href of ["https://example.com", "mailto:a@b.co", "tel:+15550100"]) {
      expect(SignatureDocSchema.safeParse({ ...base(), blocks: [{ type: "icontext", icon: "phone", text: "x", size: 20, href }] }).success).toBe(true);
    }
    for (const href of ["javascript:alert(1)", "http://example.com", "data:text/html,x"]) {
      expect(SignatureDocSchema.safeParse({ ...base(), blocks: [{ type: "icontext", icon: "phone", text: "x", size: 20, href }] }).success).toBe(false);
    }
    expect(renderToEmailHtml(withBlock({ type: "icontext", icon: "phone", text: "Ring", size: 20, href: "tel:+15550100" }))).toContain('href="tel:+15550100"');
  });
  it("escapes text and works inside a column", () => {
    const row = createRow("50-50");
    row.columns[0].blocks.push({ type: "icontext", icon: "globe", text: "<b>x</b>", size: 20 });
    const html = renderToEmailHtml(withBlock(row));
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain(emailIconUrl("globe"));
  });
  it("AI output cannot smuggle in a custom icon image or an untyped link, even inside a row", () => {
    const row = createRow("1");
    row.columns[0].blocks.push({ type: "icontext", icon: "phone", text: "x", size: 20, src: "https://tracker.example/p.gif", href: "https://evil.example" });
    const out = sanitizeDoc(withBlock(row), "make me a signature");
    const inner = (out.blocks.at(-1) as Extract<Block, { type: "row" }>).columns[0].blocks[0] as Record<string, unknown>;
    expect(inner.src).toBeUndefined();
    expect(inner.href).toBeUndefined();
  });
});
