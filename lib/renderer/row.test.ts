import { describe, expect, it } from "vitest";
import { SignatureDocSchema, measureBlocks, type Block, type SignatureDoc } from "@/lib/schema/document";
import { renderToEmailHtml } from "./email-html";
import { columnWidths } from "./row";

const theme = { primary: "#1D4ED8", text: "#111827", muted: "#6B7280", bg: "#FFFFFF", accent2: "#F4C542", font: "Arial", spacing: "normal" } as const;
const doc = (blocks: unknown[], template_id = "classic"): unknown => ({ version: 1, template_id, theme, blocks });
const id = (name: string): Block => ({ type: "identity", name });
const row = (cols: unknown[], extra: object = {}) => ({ type: "row", columns: cols.map((blocks) => ({ blocks })), ...extra });
const render = (blocks: unknown[], template = "classic") => renderToEmailHtml(SignatureDocSchema.parse(doc(blocks, template)) as SignatureDoc);

describe("row schema", () => {
  it("still parses documents that have no rows", () => {
    expect(SignatureDocSchema.safeParse(doc([id("Jane")])).success).toBe(true);
  });

  it("parses nested rows up to 3 levels and rejects a 4th", () => {
    const three = row([[row([[row([[id("deep")]])]])]]);
    expect(measureBlocks(SignatureDocSchema.parse(doc([three])).blocks).depth).toBe(3);
    const four = row([[row([[row([[row([[id("too deep")]])]])]])]]);
    expect(SignatureDocSchema.safeParse(doc([four])).success).toBe(false);
  });

  it("rejects 0 or 5 columns, bad widths and unknown child blocks", () => {
    expect(SignatureDocSchema.safeParse(doc([row([])])).success).toBe(false);
    expect(SignatureDocSchema.safeParse(doc([row([[], [], [], [], []])])).success).toBe(false);
    expect(SignatureDocSchema.safeParse(doc([{ type: "row", columns: [{ width: 2, blocks: [] }] }])).success).toBe(false);
    expect(SignatureDocSchema.safeParse(doc([row([[{ type: "nope" }]])])).success).toBe(false);
  });

  it("caps the total number of nodes", () => {
    const many = Array.from({ length: 7 }, () => row([Array.from({ length: 12 }, () => id("x"))]));
    expect(SignatureDocSchema.safeParse(doc(many)).success).toBe(false);
  });

  it("validates leaf blocks inside columns (https only)", () => {
    expect(SignatureDocSchema.safeParse(doc([row([[{ type: "button", label: "Go", href: "javascript:alert(1)" }]])])).success).toBe(false);
  });
});

describe("column widths", () => {
  it("shares the free space equally and keeps sized columns", () => {
    expect(columnWidths([{ blocks: [] }, { blocks: [] }])).toEqual([50, 50]);
    expect(columnWidths([{ width: 30, blocks: [] }, { blocks: [] }, { blocks: [] }])).toEqual([30, 35, 35]);
    expect(columnWidths([{ width: 100, blocks: [] }, { blocks: [] }])[1]).toBe(0);
  });
});

describe("row renderer", () => {
  const two = row([[id("Left")], [id("Right")]], { gap: 16 });

  it("renders columns as table cells in one table row, with no flex/grid", () => {
    const html = render([two]);
    expect(html).toContain('class="sc-row"');
    expect(html.match(/class="sc-col"/g)).toHaveLength(2);
    expect(html).toContain('width="50%"');
    expect(html).toContain('class="sc-gap" width="16"');
    expect(html).toContain("Left");
    expect(html).toContain("Right");
    expect(html).not.toMatch(/display:\s*(flex|grid)|float:/);
  });

  it("emits the stacking media query only when a row stacks", () => {
    expect(render([two])).toContain("@media only screen and (max-width:480px)");
    const off = render([row([[id("A")], [id("B")]], { stack: false })]);
    expect(off).not.toContain("@media");
    expect(off).not.toContain("sc-col");
    expect(render([id("Plain")])).not.toContain("<style");
  });

  it("finds a stacking row nested inside a non-stacking one", () => {
    const html = render([row([[row([[id("A")], [id("B")]])]], { stack: false })]);
    expect(html).toContain("@media");
  });

  it("renders every existing block type inside a column", () => {
    const html = render([
      row([
        [
          { type: "avatar", src: "https://x.test/a.png", alt: "me" },
          { type: "button", label: "Book", href: "https://x.test/book" },
          { type: "divider" },
          { type: "spacer", height: 10 },
        ],
        [
          { type: "contact", phone: "+1 555 010 2030", email: "j@x.test" },
          { type: "social", links: [{ network: "linkedin", url: "https://linkedin.com/in/j" }] },
          { type: "banner", src: "https://x.test/b.png", href: "https://x.test", width: 300, height: 80 },
          { type: "text", text: "hi" },
          { type: "disclaimer", text: "legal" },
        ],
      ]),
    ]);
    for (const needle of ["a.png", 'href="https://x.test/book"', "tel:+15550102030", "mailto:j@x.test", "linkedin.com/in/j", "b.png", "hi", "legal"]) expect(html).toContain(needle);
  });

  it("applies row and column design as inline CSS and bgcolor", () => {
    const html = render([{ ...row([[id("A")]]), style: { bg: "#EEEEEE", paddingTop: 8 } }, { type: "row", columns: [{ bg: "#FFEEAA", valign: "middle", align: "center", paddingLeft: 4, blocks: [id("B")] }] }]);
    expect(html).toContain('bgcolor="#EEEEEE"');
    expect(html).toContain("padding:8px 0px 0px 0px");
    expect(html).toContain('bgcolor="#FFEEAA"');
    expect(html).toContain('valign="middle"');
    expect(html).toContain("text-align:center");
  });

  it("does not recolour or resize children when the row has a style", () => {
    const html = render([{ ...row([[{ type: "text", text: "kid", style: { color: "#FF0000" } }]]), style: { color: "#00FF00", fontSize: 30 } }]);
    expect(html).toContain("color:#FF0000");
    expect(html).toContain("font-size:13px");
  });

  it("skips hidden rows, hidden children and empty rows", () => {
    expect(render([{ ...row([[id("Gone")]]), hidden: true }, id("Kept")])).not.toContain("Gone");
    expect(render([row([[{ ...id("Gone"), hidden: true }]]), id("Kept")])).not.toContain("Gone");
    expect(render([row([[], []]), id("Kept")])).not.toContain("sc-row");
  });

  it("escapes text inside columns", () => {
    expect(render([row([[{ type: "text", text: "<script>alert(1)</script>" }]])])).not.toContain("<script>");
  });

  it("is deterministic and works under card and studio templates", () => {
    const blocks = [id("Jane"), two];
    expect(render(blocks)).toBe(render(blocks));
    for (const t of ["modern-split", "minimal", "soft-card", "studio"]) {
      const html = render(blocks, t);
      expect(html).toContain("Left");
      expect(html).toContain("Right");
    }
  });
});
