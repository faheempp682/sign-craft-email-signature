import { describe, expect, it } from "vitest";
import { isPublicPath, publicSiteEnabled } from "./public-routes";

describe("isPublicPath", () => {
  it("always allows login, auth, cards, banners, click redirects and public APIs", () => {
    for (const p of ["/login", "/auth/callback", "/c/jane-doe", "/b/abc", "/r/abc", "/api/public/generate"]) expect(isPublicPath(p, false), p).toBe(true);
  });

  it("opens the cron endpoint and nothing next to it", () => {
    expect(isPublicPath("/api/sync/run", false)).toBe(true);
    for (const p of ["/api/sync/runs", "/api/sync/preview", "/api/sync/settings", "/api/sync/previews/abc/apply", "/api/sync/status", "/api/sync/test", "/api/sync/sources/google", "/api/sync", "/api/syncrun"]) expect(isPublicPath(p, false), p).toBe(false);
  });

  it("matches whole path segments only, so lookalike private pages stay private", () => {
    for (const p of ["/create", "/create/x", "/campaigns", "/cards", "/browse", "/render", "/api/publicity", "/api/ai/design", "/admin", "/editor", "/api/google/push"]) expect(isPublicPath(p, false), p).toBe(false);
    for (const p of ["/create", "/campaigns", "/cards", "/browse", "/render"]) expect(isPublicPath(p, true), p).toBe(false);
  });

  it("keeps the marketing site private unless it is switched on", () => {
    for (const p of ["/", "/signature-generator", "/for/recruiters", "/privacy", "/terms", "/sitemap.xml", "/robots.txt"]) {
      expect(isPublicPath(p, false), `${p} off`).toBe(false);
      expect(isPublicPath(p, true), `${p} on`).toBe(true);
    }
  });

  it("the site switch never opens the app itself", () => {
    for (const p of ["/editor", "/signatures", "/preview", "/admin/features", "/api/signatures", "/api/upload"]) expect(isPublicPath(p, true), p).toBe(false);
  });

  it("only the exact string 'true' switches the site on", () => {
    expect(publicSiteEnabled({ PUBLIC_SITE_ENABLED: "true" })).toBe(true);
    for (const v of [undefined, "", "TRUE", "1", "yes", "false"]) expect(publicSiteEnabled({ PUBLIC_SITE_ENABLED: v })).toBe(false);
  });
});
