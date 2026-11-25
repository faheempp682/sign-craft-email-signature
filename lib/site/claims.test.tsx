import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLAIMS, claimText, unverifiedClaimHits, type ClaimId } from "./claims";
import { NICHES } from "./niches";

const root = path.resolve(import.meta.dirname, "../..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** Every file that holds marketing page copy. claims.ts itself defines the wording, so it is exempt. */
function copyFiles(): string[] {
  const files = [path.join(root, "app/page.tsx"), ...walk(path.join(root, "app/(marketing)")), ...walk(path.join(root, "lib/site"))];
  return files.filter((f) => /\.(tsx?|md)$/.test(f) && !/\.test\.tsx?$/.test(f) && path.basename(f) !== "claims.ts");
}

describe("honest compatibility claims", () => {
  it("every claim is unverified for now, and says so in its design-intent wording", () => {
    for (const id of Object.keys(CLAIMS) as ClaimId[]) {
      expect(CLAIMS[id].verified, id).toBe(false);
      expect(claimText(id), id).toBe(CLAIMS[id].intent);
    }
  });

  it("the design-intent wording itself passes the check", () => {
    for (const id of Object.keys(CLAIMS) as ClaimId[]) expect(unverifiedClaimHits(CLAIMS[id].intent), id).toEqual([]);
  });

  it("catches strong wording when its switch is off, and allows it once verified", () => {
    expect(unverifiedClaimHits("Signatures that never break in Outlook.").map((h) => h.id)).toContain("outlookRendering");
    expect(unverifiedClaimHits("Renders perfectly in Outlook and tested in real Gmail.").length).toBeGreaterThanOrEqual(2);
    expect(unverifiedClaimHits("Install in one-click install mode, or push your signature straight to Gmail").map((h) => h.id)).toContain("gmailPush");
    expect(unverifiedClaimHits("Looks right on every phone and tablet mail app").map((h) => h.id)).toContain("mobileClients");
    const verified = { ...CLAIMS, outlookRendering: { ...CLAIMS.outlookRendering, verified: true } };
    expect(unverifiedClaimHits("Signatures that never break in Outlook.", verified)).toEqual([]);
    expect(claimText("outlookRendering", verified)).toBe(CLAIMS.outlookRendering.strong);
  });

  it("no source file that holds page copy contains a claim whose switch is off", () => {
    const files = copyFiles();
    expect(files.length).toBeGreaterThan(10); // the scan really found the pages
    const bad = files.flatMap((f) => unverifiedClaimHits(fs.readFileSync(f, "utf8")).map((h) => `${path.relative(root, f)}: "${h.match}" (${h.id})`));
    expect(bad).toEqual([]);
  });

  it("the rendered pages contain no unverified claim either", async () => {
    const { MarketingHome } = await import("@/app/(marketing)/home-view");
    const { default: NichePage } = await import("@/app/(marketing)/for/[niche]/page");
    const { default: GeneratorPage } = await import("@/app/(marketing)/signature-generator/page");
    const { default: Privacy } = await import("@/app/(marketing)/privacy/page");
    const { default: Terms } = await import("@/app/(marketing)/terms/page");
    const pages = [MarketingHome(), GeneratorPage(), Privacy(), Terms(), ...(await Promise.all(NICHES.map((n) => NichePage({ params: Promise.resolve({ niche: n.slug }) }))))];
    for (const el of pages) {
      const text = renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      expect(text.length).toBeGreaterThan(500);
      expect(unverifiedClaimHits(text)).toEqual([]);
    }
  });
});
