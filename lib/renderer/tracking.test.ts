import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/lib/campaigns/token";
import { SignatureDocSchema, TEMPLATE_IDS, type SignatureDoc } from "@/lib/schema/document";
import { TEMPLATE_META } from "@/lib/templates";
import classic from "@/templates/classic.json";
import { renderToEmailHtml } from "./email-html";

const SECRET = "s".repeat(40);
const SIG = "22222222-2222-4222-8222-222222222222";
const CAMP = "11111111-1111-4111-8111-111111111111";
const tracking = { baseUrl: "https://app.example.com/", signatureId: SIG, sign: (p: Parameters<typeof signToken>[0]) => signToken(p, SECRET) };

const withBanner = (banner: object, id: (typeof TEMPLATE_IDS)[number] = "classic"): SignatureDoc => {
  const base = TEMPLATE_META.find((t) => t.id === id)!.doc;
  return SignatureDocSchema.parse({ ...base, blocks: [...base.blocks, { type: "banner", src: "https://cdn.acme.com/static.png", alt: "Sale", href: "https://acme.com/sale", width: 400, height: 100, ...banner }] });
};
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("tracked banners", () => {
  it("leaves output byte-identical when the option is absent, or track is false or missing", () => {
    for (const id of TEMPLATE_IDS) {
      const plain = withBanner({}, id);
      const base = renderToEmailHtml(plain);
      expect(renderToEmailHtml(plain, { tracking })).toBe(base); // track not set
      expect(renderToEmailHtml(withBanner({ track: false, campaign_id: CAMP }, id), { tracking })).toBe(renderToEmailHtml(withBanner({ campaign_id: CAMP }, id)));
      expect(renderToEmailHtml(withBanner({ track: true }, id))).toBe(base); // no options: nothing to sign with
    }
  });

  it("existing documents without the new fields still validate", () => {
    expect(SignatureDocSchema.safeParse(classic).success).toBe(true);
  });

  it("wraps the link in a signed /r token that carries the original destination", () => {
    const html = renderToEmailHtml(withBanner({ track: true }), { tracking });
    const link = hrefs(html).find((h) => h.includes("/r/"))!;
    expect(link.startsWith("https://app.example.com/r/")).toBe(true);
    const p = verifyToken(link.split("/r/")[1], SECRET, "r");
    expect(p).toEqual({ t: "r", s: SIG, h: "https://acme.com/sale" });
    expect(html).toContain("https://cdn.acme.com/static.png"); // no campaign: image untouched
  });

  it("serves the image from /b when a campaign is attached, with the static banner as the signed fallback", () => {
    const html = renderToEmailHtml(withBanner({ track: true, campaign_id: CAMP }), { tracking });
    const src = html.match(/<img src="([^"]+\/b\/[^"]+)"/)![1];
    expect(verifyToken(src.split("/b/")[1], SECRET, "b")).toEqual({ t: "b", c: CAMP, s: SIG, f: "https://cdn.acme.com/static.png" });
    const link = hrefs(html).find((h) => h.includes("/r/"))!;
    expect(verifyToken(link.split("/r/")[1], SECRET, "r")).toMatchObject({ c: CAMP, s: SIG });
  });

  it("works in the designed card layouts too, and stays Outlook-safe", () => {
    for (const id of TEMPLATE_IDS) {
      const html = renderToEmailHtml(withBanner({ track: true, campaign_id: CAMP }, id), { tracking });
      expect(html).toContain("/r/");
      for (const banned of [/display:\s*flex/i, /<script/i, /<svg/i, /background-image/i]) expect(html).not.toMatch(banned);
      for (const img of html.match(/<img[^>]*>/g) ?? []) expect(img).toMatch(/alt="/);
    }
  });

  it("does not leak the tracking context into a later render", () => {
    renderToEmailHtml(withBanner({ track: true }), { tracking });
    expect(renderToEmailHtml(withBanner({ track: true }))).not.toContain("/r/");
  });

  it("a banner with no link and no campaign gets no redirect", () => {
    const html = renderToEmailHtml(withBanner({ track: true, href: undefined }), { tracking });
    expect(html).not.toContain("/r/");
  });
});
