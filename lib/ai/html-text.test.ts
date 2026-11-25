import { describe, expect, it } from "vitest";
import { decodeEntities, digestPage } from "./html-text";

const PAGE = `<!doctype html><html><head>
<title>Jane Doe &ndash; Senior Designer | Acme</title>
<meta name="description" content="Jane designs brands &amp; products.">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Person","name":"Jane Doe","jobTitle":"Senior Designer","worksFor":{"@type":"Organization","name":"Acme Inc."},
 "email":"mailto:jane@acme.com","telephone":"+1 555 010 2030","url":"https://acme.com/jane",
 "sameAs":["https://www.linkedin.com/in/janedoe","https://github.com/janedoe"],
 "address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Austin","addressRegion":"TX"}}
</script>
<style>.hidden{display:none}</style>
<script>var secret = "do not read this";</script>
</head><body>
<nav><a href="/about">About</a></nav>
<h1>Jane Doe</h1><p>Senior Designer at Acme&nbsp;Inc.</p>
<a href="mailto:jane@acme.com?subject=Hi">Email me</a>
<a href="tel:+15550102030">Call</a>
<a href="https://www.linkedin.com/in/janedoe/?utm_source=x">LinkedIn</a>
<a href="https://twitter.com/janedoe">X</a>
<a href="https://twitter.com/">X home</a>
<a href="/relative/instagram">relative</a>
<a href="https://example.org/blog">Blog</a>
<!-- a comment with jane-hidden@acme.com -->
<noscript>enable js</noscript>
</body></html>`;

describe("digestPage", () => {
  const d = digestPage(PAGE, "https://acme.com/team/jane");

  it("reads the title and meta description, decoding entities", () => {
    expect(d.title).toBe("Jane Doe - Senior Designer | Acme");
    expect(d.description).toBe("Jane designs brands & products.");
  });

  it("extracts structured schema.org data", () => {
    expect(d.structured).toEqual(expect.arrayContaining([
      "Person.name: Jane Doe",
      "Person.jobTitle: Senior Designer",
      "Person.worksFor: Acme Inc.",
      "Person.email: jane@acme.com",
      "Person.telephone: +1 555 010 2030",
      "Person.address: 1 Main St, Austin, TX",
    ]));
    expect(d.structured.some((l) => l.includes("linkedin.com/in/janedoe"))).toBe(true);
  });

  it("collects mailto, tel and social links, dropping query strings and bare homepages", () => {
    expect(d.emails).toEqual(["jane@acme.com"]);
    expect(d.phones).toEqual(["+15550102030"]);
    expect(d.social).toEqual(expect.arrayContaining(["https://linkedin.com/in/janedoe", "https://twitter.com/janedoe"]));
    expect(d.social).not.toContain("https://twitter.com");
    expect(d.social.some((s) => s.includes("example.org"))).toBe(false);
  });

  it("removes scripts, styles, comments and noscript from the text", () => {
    expect(d.text).not.toContain("secret");
    expect(d.text).not.toContain("display:none");
    expect(d.text).not.toContain("jane-hidden");
    expect(d.text).not.toContain("enable js");
    expect(d.text).toContain("Jane Doe");
    expect(d.text).toContain("Senior Designer at Acme Inc.");
  });
});

describe("digestPage: size limits", () => {
  it("keeps the start and the end of a long page, so a footer contact survives", () => {
    const html = `<body><p>START ${"filler ".repeat(5000)}</p><footer>Call us: 555-867-5309 · hello@acme.com</footer></body>`;
    const d = digestPage(html, "https://acme.com", 3000);
    expect(d.text.length).toBeLessThan(3100);
    expect(d.text).toContain("START");
    expect(d.text).toContain("555-867-5309");
    expect(d.text).toContain("hello@acme.com");
    expect(d.text).toContain("[...]");
  });

  it("copes with empty, broken and hostile input", () => {
    expect(() => digestPage("", "https://acme.com")).not.toThrow();
    expect(() => digestPage("<<<>>><a href=", "https://acme.com")).not.toThrow();
    expect(() => digestPage('<script type="application/ld+json">{not json</script>', "https://acme.com")).not.toThrow();
    expect(digestPage('<script type="application/ld+json">{not json</script>', "https://acme.com").structured).toEqual([]);
  });

  it.each([
    ["unclosed comments", "<!--".repeat(60000)],
    ["unclosed anchors", "<a href=".repeat(30000)],
    ["unclosed scripts", "<script>".repeat(30000)],
    ["unclosed styles and svgs", "<style><svg>".repeat(20000)],
    ["a million less-than signs", "<".repeat(1_000_000)],
    ["a million ampersands", "&amp".repeat(200_000)],
    ["long entity-like runs", ("&" + "a".repeat(50)).repeat(20000)],
    ["unclosed meta tags", '<meta name="description" content="'.repeat(30000)],
    ["unclosed title", "<title>".repeat(30000)],
    ["deeply repeated JSON-LD", '<script type="application/ld+json">{"@type":"Person"'.repeat(5000)],
    ["tags with huge attributes", `<a href="${"x".repeat(1_000_000)}">`],
    ["mixed junk", "<a <b <!-- <script <meta <title & &#x ".repeat(20000)],
  ])("stays fast on hostile input: %s", (_name, evil) => {
    const started = Date.now();
    expect(() => digestPage(evil, "https://acme.com")).not.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("ignores javascript: and data: links", () => {
    const d = digestPage('<a href="javascript:alert(1)">x</a><a href="data:text/html,hi">y</a>', "https://acme.com");
    expect(d.social).toEqual([]);
    expect(d.emails).toEqual([]);
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities and leaves unknown ones", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#65;&#x42; &unknownthing;")).toBe("a & b <c> AB &unknownthing;");
  });
  it("does not produce invalid code points", () => {
    expect(() => decodeEntities("&#99999999;&#0;")).not.toThrow();
  });
});
