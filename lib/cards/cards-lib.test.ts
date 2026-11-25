import { beforeEach, describe, expect, it } from "vitest";
import { httpsHref, inkOn, mailHref, safeColor, telHref } from "./links";
import { clientKey, hit, resetRateLimits } from "./rate-limit";
import { CardInputSchema, RESERVED_SLUGS, slugProblem, slugify, type PublicCard } from "./schema";
import { cardUrl, signatureCardLink } from "./signature-link";
import { buildVCard, escapeText, foldLine, splitName, vcardFilename } from "./vcard";
import { formFromCard, parseForm, previewCard } from "./form";

const card = (o: Partial<PublicCard> = {}): PublicCard => ({
  slug: "ada-lovelace", display_name: "Ada King Lovelace", title: "Analyst", company: "Analytical Engines, Ltd.", bio: "Wrote the first program; loved math.",
  photo_url: "https://cdn.example.com/ada.jpg", phone: "+44 20 7946 0958", email: "ada@example.com", website: "https://example.com", address: "12 St James's Square\nLondon, UK",
  social_links: [{ network: "linkedin", url: "https://linkedin.com/in/ada" }], booking_url: "https://cal.example.com/ada", accent_color: "#1d4ed8", indexable: false, ...o,
});

/** A small, independent vCard 3.0 reader: unfold, split name;params:value, unescape TEXT. Used to read our own output back. */
function parse(vcf: string) {
  expect(vcf.endsWith("\r\n")).toBe(true);
  expect(vcf).not.toMatch(/(?<!\r)\n/); // no bare LF anywhere
  const unfolded = vcf.replace(/\r\n[ \t]/g, "");
  const lines = unfolded.split("\r\n").filter(Boolean);
  for (const raw of vcf.split("\r\n")) expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(75);
  const props = lines.map((l) => {
    const i = l.indexOf(":");
    const [name, ...params] = l.slice(0, i).split(";");
    return { name, params, value: l.slice(i + 1) };
  });
  return props;
}
const unescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const splitUnescaped = (v: string) => v.split(/(?<!\\);/);

describe("links: only https, mailto and tel survive", () => {
  it.each(["javascript:alert(1)", "data:text/html,x", "http://example.com", "ftp://example.com", "//example.com", "https://user:pw@example.com", "https://example.com/a b", "https://localhost", "https://exa\nmple.com", "", "vbscript:x", "  https://example.com"])("httpsHref rejects %j", (v) => {
    expect(httpsHref(v)).toBeNull();
  });
  it("httpsHref accepts and normalises https", () => {
    expect(httpsHref("https://Example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(httpsHref(null)).toBeNull();
  });
  it("telHref keeps digits and a leading plus", () => {
    expect(telHref("+1 (555) 010-0100")).toBe("tel:+15550100100");
    expect(telHref("555.0100")).toBe("tel:5550100");
    expect(telHref("javascript:1")).toBeNull();
    expect(telHref("12")).toBeNull();
  });
  it("mailHref refuses extra recipients and header tricks", () => {
    expect(mailHref("a@b.co")).toBe("mailto:a@b.co");
    expect(mailHref("a@b.co,evil@x.com")).toBeNull();
    expect(mailHref("a@b.co?bcc=evil@x.com")).toBeNull();
    expect(mailHref("a@b.co\r\nBcc: x@y.z")).toBeNull();
    expect(mailHref("nope")).toBeNull();
  });
  it("colours are validated and ink contrasts", () => {
    expect(safeColor("red; background:url(x)")).toBe("#111111");
    expect(safeColor("#AABBCC")).toBe("#AABBCC");
    expect(inkOn("#ffffff")).toBe("#111111");
    expect(inkOn("#000000")).toBe("#ffffff");
  });
});

describe("slugs", () => {
  it("explains what is wrong", () => {
    expect(slugProblem("ab")).toMatch(/3 to 40/);
    expect(slugProblem("Ada")).toMatch(/lowercase/);
    expect(slugProblem("-ada")).toMatch(/Start and end/);
    expect(slugProblem("a".repeat(41))).toMatch(/3 to 40/);
    expect(slugProblem("admin")).toMatch(/reserved/);
    expect(slugProblem("ada-lovelace")).toBeNull();
  });
  it("every reserved word is refused when it is long enough to be a slug", () => {
    for (const w of RESERVED_SLUGS) if (w.length >= 3) expect(slugProblem(w)).not.toBeNull();
  });
  it("slugify makes tidy suggestions", () => {
    expect(slugify("Zoë O'Neil-Smith!")).toBe("zoe-o-neil-smith");
    expect(slugify("  ")).toBe("");
  });
});

describe("CardInputSchema", () => {
  const base = { slug: "Ada-Lovelace", display_name: " Ada ", social_links: [] };
  it("normalises and applies safe defaults (private, noindex)", () => {
    const r = CardInputSchema.parse(base);
    expect(r).toMatchObject({ slug: "ada-lovelace", display_name: "Ada", published: false, indexable: false, accent_color: "#111111", bio: null, website: null });
  });
  it("refuses non-https links anywhere", () => {
    for (const k of ["website", "photo_url", "booking_url"]) expect(CardInputSchema.safeParse({ ...base, [k]: "http://x.com" }).success).toBe(false);
    expect(CardInputSchema.safeParse({ ...base, social_links: [{ network: "github", url: "javascript:alert(1)" }] }).success).toBe(false);
    expect(CardInputSchema.safeParse({ ...base, social_links: [{ network: "myspace", url: "https://x.com/a" }] }).success).toBe(false);
  });
  it("caps bio at 300 and socials at 10", () => {
    expect(CardInputSchema.safeParse({ ...base, bio: "x".repeat(301) }).success).toBe(false);
    expect(CardInputSchema.safeParse({ ...base, bio: "x".repeat(300) }).success).toBe(true);
    const many = Array.from({ length: 11 }, () => ({ network: "github", url: "https://github.com/a" }));
    expect(CardInputSchema.safeParse({ ...base, social_links: many }).success).toBe(false);
  });
  it("refuses control characters in text", () => {
    expect(CardInputSchema.safeParse({ ...base, title: "CTO\u0000" }).success).toBe(false);
  });
  it("the form helpers round trip and report errors per field", () => {
    const f = formFromCard({ slug: "ada", display_name: "Ada" });
    expect(parseForm(f).ok).toBe(true);
    const bad = parseForm({ ...f, website: "http://nope.com", social_links: [{ network: "github", url: "nope" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.website).toMatch(/https/);
      expect(bad.errors.social_rows?.[0]).toMatch(/https/);
    }
    expect(previewCard({ ...f, display_name: "" }).display_name).toBe("Your name");
  });
});

describe("vCard 3.0", () => {
  it("is a well-formed CRLF file with the required properties", () => {
    const props = parse(buildVCard(card(), "https://sign.example.com/c/ada-lovelace"));
    expect(props[0]).toMatchObject({ name: "BEGIN", value: "VCARD" });
    expect(props[1]).toMatchObject({ name: "VERSION", value: "3.0" });
    expect(props.at(-1)).toMatchObject({ name: "END", value: "VCARD" });
    expect(props.filter((p) => p.name === "FN")).toHaveLength(1);
    expect(props.filter((p) => p.name === "N")).toHaveLength(1);
  });

  it("reads back to the same data", () => {
    const props = parse(buildVCard(card(), "https://sign.example.com/c/ada-lovelace"));
    const get = (n: string) => props.filter((p) => p.name === n);
    expect(unescape(get("FN")[0].value)).toBe("Ada King Lovelace");
    const n = splitUnescaped(get("N")[0].value).map(unescape);
    expect(n.slice(0, 2)).toEqual(["Lovelace", "Ada King"]);
    expect(unescape(get("ORG")[0].value)).toBe("Analytical Engines, Ltd.");
    expect(unescape(get("TITLE")[0].value)).toBe("Analyst");
    expect(get("TEL")[0].value).toBe("+442079460958");
    expect(get("EMAIL")[0].value).toBe("ada@example.com");
    expect(unescape(get("NOTE")[0].value)).toBe("Wrote the first program; loved math.");
    expect(splitUnescaped(get("ADR")[0].value).map(unescape)[2]).toBe("12 St James's Square\nLondon, UK");
    expect(get("URL").map((p) => p.value)).toEqual(expect.arrayContaining(["https://example.com/", "https://sign.example.com/c/ada-lovelace", "https://cal.example.com/ada"]));
    expect(get("PHOTO")[0].value).toBe("https://cdn.example.com/ada.jpg");
    expect(get("X-SOCIALPROFILE")[0]).toMatchObject({ params: ["TYPE=linkedin"], value: "https://linkedin.com/in/ada" });
  });

  it("escapes backslash, semicolon, comma and newline", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });

  it("strips other control characters (NUL, vertical tab, escape, DEL) from text", () => {
    expect(escapeText("a\u0000b\u000bc\u001bd\u007fe")).toBe("abcde");
  });

  it("cannot be tricked into a new property by CRLF in any field", () => {
    const evil = "Ada\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Evil";
    const vcf = buildVCard(card({ display_name: evil, title: evil, company: evil, bio: evil, address: evil, email: "a@b.co\r\nBCC:x@y.z", phone: "555\r\nX-EVIL:1", website: "https://example.com/\r\nX-EVIL:1" }), "https://x.example.com/c/a");
    const props = parse(vcf);
    expect(props.filter((p) => p.name === "BEGIN")).toHaveLength(1);
    expect(props.filter((p) => p.name === "END")).toHaveLength(1);
    expect(props.filter((p) => p.name === "FN")).toHaveLength(1);
    expect(props.some((p) => p.name.startsWith("X-EVIL") || p.name === "BCC")).toBe(false);
    expect(vcf).not.toMatch(/\r\nFN:Evil/);
  });

  it("folds long lines at 75 octets without splitting a multibyte character", () => {
    const long = "é".repeat(200);
    const folded = foldLine(`NOTE:${long}`);
    for (const l of folded.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`NOTE:${long}`);
    const props = parse(buildVCard(card({ bio: "x".repeat(300) }), "https://x.example.com/c/a"));
    expect(unescape(props.find((p) => p.name === "NOTE")!.value)).toBe("x".repeat(300));
  });

  it("drops unsafe links instead of emitting them", () => {
    const vcf = buildVCard(card({ website: "javascript:alert(1)", photo_url: "http://x.com/a.jpg", booking_url: "data:text/html,x", social_links: [{ network: "github", url: "javascript:1" }], email: "not-an-email", phone: "abc" }), "https://x.example.com/c/a");
    expect(vcf).not.toMatch(/javascript|data:text|http:\/\/|PHOTO|TEL|EMAIL|X-SOCIALPROFILE/);
  });

  it("splits names and builds safe filenames", () => {
    expect(splitName("Madonna")).toEqual({ family: "", given: "Madonna" });
    expect(splitName("Ada King Lovelace")).toEqual({ family: "Lovelace", given: "Ada King" });
    expect(vcardFilename("ada-lovelace")).toBe("ada-lovelace.vcf");
    expect(vcardFilename('x"; filename=evil.exe\r\n')).toBe("xfilenameevilexe.vcf");
    expect(vcardFilename("")).toBe("contact.vcf");
  });
});

describe("signature link helper", () => {
  it("returns the public address of a card", () => {
    expect(cardUrl("Ada-Lovelace", "https://sign.example.com")).toBe("https://sign.example.com/c/ada-lovelace");
    expect(cardUrl("ada", "https://sign.example.com/some/path?x=1")).toBe("https://sign.example.com/c/ada");
    expect(cardUrl("ada", "http://localhost:3200")).toBe("http://localhost:3200/c/ada");
  });
  it("refuses bad slugs and non-https origins", () => {
    expect(cardUrl("../etc", "https://a.com")).toBeNull();
    expect(cardUrl("ab", "https://a.com")).toBeNull();
    expect(cardUrl("ada", "http://evil.com")).toBeNull();
    expect(cardUrl("ada", "javascript:alert(1)")).toBeNull();
    expect(cardUrl("ada", "not a url")).toBeNull();
    expect(signatureCardLink("ada", "https://a.com")).toEqual({ href: "https://a.com/c/ada", label: "View my digital card" });
    expect(signatureCardLink("x", "https://a.com")).toBeNull();
  });
});

describe("rate limiter", () => {
  beforeEach(resetRateLimits);
  it("allows up to the limit, then blocks until the window passes", () => {
    for (let i = 0; i < 3; i++) expect(hit("k", 3, 1000, 1000 + i).allowed).toBe(true);
    const blocked = hit("k", 3, 1000, 1500);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
    expect(hit("k", 3, 1000, 2100).allowed).toBe(true);
  });
  it("keeps callers separate", () => {
    hit("a", 1, 1000, 1);
    expect(hit("a", 1, 1000, 2).allowed).toBe(false);
    expect(hit("b", 1, 1000, 2).allowed).toBe(true);
  });
  it("reads the caller from forwarding headers", () => {
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }))).toBe("1.2.3.4");
    expect(clientKey(new Request("http://x"))).toBe("unknown");
  });
});
