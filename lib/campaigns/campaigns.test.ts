import { describe, expect, it, vi } from "vitest";
import { createLimiter, deviceClass } from "./limiter";
import { handleBanner, handleClick, type CampaignStore, type PublicCampaign, type PublicDeps } from "./public";
import { csvCell, summarize, toCsv, type StatRow } from "./stats";
import { readSecret, safeTarget, signToken, verifyToken, visitorHash } from "./token";
import { isRunning, pickVariant } from "./variant";

const SECRET = "x".repeat(40);
const C = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333333";
const V2 = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-06-15T12:00:00Z");

describe("tokens", () => {
  const payload = { t: "r" as const, c: C, s: S, h: "https://acme.com/sale" };

  it("round-trips a signed payload", () => {
    expect(verifyToken(signToken(payload, SECRET), SECRET, "r")).toEqual(payload);
  });

  it("refuses a different secret, a tampered body, a tampered signature and the wrong kind", () => {
    const tok = signToken(payload, SECRET);
    const [body, sig] = tok.split(".");
    expect(verifyToken(tok, "y".repeat(40), "r")).toBeNull();
    const evil = Buffer.from(JSON.stringify({ ...payload, h: "https://evil.example/" })).toString("base64url");
    expect(verifyToken(`${evil}.${sig}`, SECRET, "r")).toBeNull();
    expect(verifyToken(`${body}.${sig.slice(0, -2)}AA`, SECRET, "r")).toBeNull();
    expect(verifyToken(tok, SECRET, "b")).toBeNull();
  });

  it("fails closed without a secret and on malformed input", () => {
    const tok = signToken(payload, SECRET);
    expect(verifyToken(tok, null, "r")).toBeNull();
    for (const bad of ["", "abc", "a.b.c", "....", "a".repeat(5000), "!!.!!", undefined, 42, null]) expect(verifyToken(bad, SECRET, "r")).toBeNull();
  });

  it("refuses a correctly signed payload that holds an unsafe target or extra keys", () => {
    for (const p of [{ ...payload, h: "javascript:alert(1)" }, { ...payload, h: "http://acme.com" }, { ...payload, h: "https://user:pw@acme.com" }, { ...payload, extra: 1 }, { ...payload, s: "nope" }]) {
      expect(verifyToken(signToken(p as never, SECRET), SECRET, "r")).toBeNull();
    }
  });

  it("needs a long secret", () => {
    expect(readSecret({ CAMPAIGN_TOKEN_SECRET: "short" })).toBeNull();
    expect(readSecret({})).toBeNull();
    expect(readSecret({ CAMPAIGN_TOKEN_SECRET: SECRET })).toBe(SECRET);
  });

  it("safeTarget only allows plain https URLs", () => {
    expect(safeTarget("https://acme.com/a?b=1")).toBe("https://acme.com/a?b=1");
    for (const bad of ["http://a.com", "//a.com", "javascript:x", "https://u:p@a.com", "https://a.com/\nx", "https://a.com/ x", "", null, 5]) expect(safeTarget(bad)).toBeNull();
  });

  it("visitor hashes change with the day and never contain the address", () => {
    const a = visitorHash(SECRET, "2026-06-15", "203.0.113.9", "UA");
    expect(visitorHash(SECRET, "2026-06-15", "203.0.113.9", "UA")).toBe(a);
    expect(visitorHash(SECRET, "2026-06-16", "203.0.113.9", "UA")).not.toBe(a);
    expect(a).not.toContain("203");
    expect(a).toHaveLength(32);
  });
});

describe("A/B variant choice", () => {
  const vs = [
    { id: V1, weight: 1 },
    { id: V2, weight: 1 },
  ];

  it("gives the same signature the same variant every time, whatever the row order", () => {
    const first = pickVariant(vs, C, S);
    for (let i = 0; i < 20; i++) expect(pickVariant([...vs].reverse(), C, S)?.id).toBe(first?.id);
  });

  it("follows the weights across many signatures", () => {
    const heavy = [
      { id: V1, weight: 9 },
      { id: V2, weight: 1 },
    ];
    let a = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (pickVariant(heavy, C, `sig-${i}`)?.id === V1) a++;
    expect(a / n).toBeGreaterThan(0.86);
    expect(a / n).toBeLessThan(0.94);
  });

  it("never picks a zero-weight variant, and returns null when there is nothing to pick", () => {
    for (let i = 0; i < 200; i++) expect(pickVariant([{ id: V1, weight: 0 }, { id: V2, weight: 3 }], C, `s${i}`)?.id).toBe(V2);
    expect(pickVariant([], C, S)).toBeNull();
    expect(pickVariant([{ id: V1, weight: 0 }], C, S)).toBeNull();
  });
});

describe("schedule", () => {
  const base = { status: "active", starts_at: "2026-06-01T00:00:00Z", ends_at: "2026-07-01T00:00:00Z" };
  it("runs only inside the window and only when active", () => {
    expect(isRunning(base, NOW)).toBe(true);
    expect(isRunning({ ...base, starts_at: "2026-06-16T00:00:00Z" }, NOW)).toBe(false);
    expect(isRunning({ ...base, ends_at: "2026-06-15T12:00:00Z" }, NOW)).toBe(false);
    expect(isRunning({ ...base, status: "paused" }, NOW)).toBe(false);
    expect(isRunning({ ...base, status: "draft" }, NOW)).toBe(false);
    expect(isRunning({ status: "active", starts_at: null, ends_at: null }, NOW)).toBe(true);
  });
});

describe("limiter and device class", () => {
  it("allows up to max per window, then refuses, then resets", () => {
    const l = createLimiter({ max: 2, windowMs: 1000 });
    expect([l.allow("k", 0), l.allow("k", 1), l.allow("k", 2)]).toEqual([true, true, false]);
    expect(l.allow("other", 3)).toBe(true);
    expect(l.allow("k", 1500)).toBe(true);
  });

  it("keeps memory bounded", () => {
    const l = createLimiter({ max: 1, windowMs: 10_000, maxKeys: 3 });
    for (let i = 0; i < 50; i++) l.allow(`k${i}`, i);
    expect(l.allow("k0", 60)).toBe(true); // oldest were evicted, so it counts as new
  });

  it("classifies coarsely", () => {
    expect(deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("mobile");
    expect(deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(deviceClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe("desktop");
    expect(deviceClass("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("mobile");
    expect(deviceClass(null)).toBe("other");
  });
});

describe("stats and csv", () => {
  const rows: StatRow[] = [
    { campaign_id: C, variant_id: V1, day: "2026-06-01", clicks: 3, unique_clicks: 2, image_loads: 30 },
    { campaign_id: C, variant_id: V2, day: "2026-06-01", clicks: 1, unique_clicks: 1, image_loads: 10 },
    { campaign_id: C, variant_id: V1, day: "2026-06-03", clicks: 2, unique_clicks: 2, image_loads: 20 },
  ];
  const campaigns = [{ id: C, name: "Spring, \"sale\"", variants: [{ id: V1, label: "A" }, { id: V2, label: "" }] }];

  it("totals per campaign, variant and day, filling empty days", () => {
    const [t] = summarize(rows, campaigns, "2026-06-01", "2026-06-04");
    expect(t).toMatchObject({ clicks: 6, uniqueClicks: 5, imageLoads: 60 });
    expect(t.variants.map((v) => [v.label, v.clicks, v.ctr])).toEqual([["A", 5, 0.1], ["Variant B", 1, 0.1]]);
    expect(t.days.map((d) => d.clicks)).toEqual([4, 0, 2, 0]);
  });

  it("has no ctr when there are no image loads", () => {
    const [t] = summarize([], campaigns, "2026-06-01", "2026-06-01");
    expect(t.ctr).toBeNull();
  });

  it("exports csv that cannot run as a spreadsheet formula and quotes properly", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("a,b")).toBe("\"a,b\"");
    const totals = summarize(rows, campaigns, "2026-06-01", "2026-06-03");
    const csv = toCsv(totals, rows, campaigns);
    expect(csv.split("\r\n")[0]).toBe("date,campaign,variant,clicks,unique_clicks_that_day,image_loads_not_impressions");
    expect(csv).toContain("2026-06-01,\"Spring, \"\"sale\"\"\",A,3,2,30");
  });
});

/* ------------------------------------------------------------- public endpoints */

const campaign = (over: Partial<PublicCampaign> = {}): PublicCampaign => ({
  id: C,
  org_id: "org",
  status: "active",
  starts_at: "2026-06-01T00:00:00Z",
  ends_at: "2026-07-01T00:00:00Z",
  href: "https://acme.com/landing",
  fallback_src: "https://cdn.acme.com/static.png",
  variants: [{ id: V1, image_url: "https://cdn.acme.com/a.png", weight: 1 }],
  ...over,
});

function deps(over: { campaign?: PublicCampaign | null; secret?: string | null; allow?: boolean; throws?: boolean } = {}) {
  const store = {
    getCampaign: vi.fn(async () => {
      if (over.throws) throw new Error("db down");
      return over.campaign === undefined ? campaign() : over.campaign;
    }),
    recordImageLoad: vi.fn(async () => {}),
    recordClick: vi.fn(async () => {}),
  } satisfies CampaignStore;
  const d: PublicDeps = { secret: over.secret === undefined ? SECRET : over.secret, store, now: () => NOW, limiter: { allow: () => over.allow ?? true } };
  return { d, store };
}
const get = (path: string, init: RequestInit = {}) => new Request(`https://app.test${path}`, { headers: { "x-forwarded-for": "203.0.113.5", "user-agent": "Mozilla/5.0 (iPhone)" }, ...init });
const rTok = (extra: object = {}) => signToken({ t: "r", c: C, s: S, ...extra }, SECRET);
const bTok = (extra: object = {}) => signToken({ t: "b", c: C, s: S, f: "https://cdn.acme.com/static.png", ...extra }, SECRET);

describe("/r click endpoint", () => {
  it("logs the click and redirects to the STORED campaign link, not anything in the request", async () => {
    const { d, store } = deps();
    const res = await handleClick(get("/r/x?to=https://evil.example"), rTok(), d);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://acme.com/landing");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(store.recordClick).toHaveBeenCalledWith(C, V1, "mobile", expect.stringMatching(/^[0-9a-f]{32}$/));
  });

  it("prefers the stored campaign link over the destination signed into the token", async () => {
    const { d } = deps();
    const res = await handleClick(get("/r/x"), rTok({ h: "https://old.example/stale" }), d);
    expect(res.headers.get("location")).toBe("https://acme.com/landing");
  });

  it("never stores the address or user agent", async () => {
    const { d, store } = deps();
    await handleClick(get("/r/x"), rTok(), d);
    expect(JSON.stringify(store.recordClick.mock.calls)).not.toMatch(/203\.0\.113|Mozilla/);
  });

  it("uses the signed target when no campaign is attached", async () => {
    const { d, store } = deps({ campaign: null });
    const res = await handleClick(get("/r/x"), signToken({ t: "r", s: S, h: "https://acme.com/plain" }, SECRET), d);
    expect(res.headers.get("location")).toBe("https://acme.com/plain");
    expect(store.recordClick).not.toHaveBeenCalled();
  });

  it("answers a deleted campaign with no signed target exactly like a bad token", async () => {
    const { d } = deps({ campaign: null });
    const gone = await handleClick(get("/r/x"), rTok(), d);
    const bad = await handleClick(get("/r/x"), "garbage", d);
    expect([gone.status, await gone.text(), gone.headers.get("location")]).toEqual([bad.status, await bad.text(), bad.headers.get("location")]);
    expect(gone.status).toBe(404);
  });

  it("refuses every malformed or tampered token with the same empty 404", async () => {
    const { d, store } = deps();
    const tok = rTok();
    for (const bad of ["", "x", `${tok}A`, tok.replace(/.$/, "A"), bTok(), "a.b", "%00", "../../etc/passwd"]) {
      const res = await handleClick(get("/r/x"), bad, d);
      expect(res.status).toBe(404);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.text()).toBe("");
    }
    expect(store.getCampaign).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is not configured", async () => {
    const { d } = deps({ secret: null });
    expect((await handleClick(get("/r/x"), rTok(), d)).status).toBe(404);
  });

  it("still redirects when the database fails, and when counting fails", async () => {
    const down = deps({ throws: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleClick(get("/r/x"), signToken({ t: "r", c: C, s: S, h: "https://acme.com/plain" }, SECRET), down.d);
    expect(res.headers.get("location")).toBe("https://acme.com/plain");
    const ok = deps();
    ok.store.recordClick.mockRejectedValueOnce(new Error("boom"));
    expect((await handleClick(get("/r/x"), rTok(), ok.d)).status).toBe(302);
  });

  it("does not count HEAD requests", async () => {
    const { d, store } = deps();
    await handleClick(get("/r/x", { method: "HEAD" }), rTok(), d);
    expect(store.recordClick).not.toHaveBeenCalled();
  });

  it("rate limits: redirects without logging when the target is signed, otherwise 429", async () => {
    const { d, store } = deps({ allow: false });
    const withTarget = await handleClick(get("/r/x"), rTok({ h: "https://acme.com/plain" }), d);
    expect(withTarget.status).toBe(302);
    expect((await handleClick(get("/r/x"), rTok(), d)).status).toBe(429);
    expect(store.getCampaign).not.toHaveBeenCalled();
    expect(store.recordClick).not.toHaveBeenCalled();
  });

  it("does not log a variant for a campaign that is not running (paused clicks still reach the destination)", async () => {
    const { d, store } = deps({ campaign: campaign({ status: "paused" }) });
    const res = await handleClick(get("/r/x"), rTok(), d);
    expect(res.headers.get("location")).toBe("https://acme.com/landing");
    expect(store.recordClick).toHaveBeenCalledWith(C, null, "mobile", expect.any(String));
  });
});

describe("/b banner endpoint", () => {
  it("redirects to the chosen variant image and counts an image load", async () => {
    const { d, store } = deps();
    const res = await handleBanner(get("/b/x"), bTok(), d);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.acme.com/a.png");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    expect(store.recordImageLoad).toHaveBeenCalledWith(C, V1);
  });

  it("serves the same variant to the same signature, and A/B splits across signatures", async () => {
    const two = campaign({ variants: [{ id: V1, image_url: "https://cdn.acme.com/a.png", weight: 1 }, { id: V2, image_url: "https://cdn.acme.com/b.png", weight: 1 }] });
    const { d } = deps({ campaign: two });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const sig = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      const tok = signToken({ t: "b", c: C, s: sig, f: "https://cdn.acme.com/static.png" }, SECRET);
      const a = (await handleBanner(get("/b/x"), tok, d)).headers.get("location");
      expect((await handleBanner(get("/b/x"), tok, d)).headers.get("location")).toBe(a);
      seen.add(a!);
    }
    expect(seen.size).toBe(2);
  });

  it("falls back to the signed static banner outside the schedule, when paused, or when the campaign is unknown", async () => {
    for (const camp of [campaign({ starts_at: "2026-07-01T00:00:00Z", ends_at: null }), campaign({ ends_at: "2026-06-10T00:00:00Z" }), campaign({ status: "paused" }), campaign({ variants: [] }), null]) {
      const { d } = deps({ campaign: camp });
      const res = await handleBanner(get("/b/x"), bTok(), d);
      expect(res.headers.get("location")).toBe("https://cdn.acme.com/static.png");
    }
  });

  it("unknown campaign and inactive campaign look identical to the caller", async () => {
    const a = await handleBanner(get("/b/x"), bTok(), deps({ campaign: null }).d);
    const b = await handleBanner(get("/b/x"), bTok(), deps({ campaign: campaign({ status: "paused" }) }).d);
    expect([a.status, a.headers.get("location"), a.headers.get("cache-control")]).toEqual([b.status, b.headers.get("location"), b.headers.get("cache-control")]);
  });

  it("refuses bad tokens and a click token, and falls back (without the database) when rate limited", async () => {
    const { d, store } = deps();
    expect((await handleBanner(get("/b/x"), "nope", d)).status).toBe(404);
    expect((await handleBanner(get("/b/x"), rTok(), d)).status).toBe(404);
    const limited = deps({ allow: false });
    const res = await handleBanner(get("/b/x"), bTok(), limited.d);
    expect(res.headers.get("location")).toBe("https://cdn.acme.com/static.png");
    expect(limited.store.getCampaign).not.toHaveBeenCalled();
    expect(store.recordImageLoad).not.toHaveBeenCalled();
  });

  it("refuses to redirect to a stored image URL that is not plain https", async () => {
    const { d } = deps({ campaign: campaign({ variants: [{ id: V1, image_url: "javascript:alert(1)", weight: 1 }] }) });
    expect((await handleBanner(get("/b/x"), bTok(), d)).headers.get("location")).toBe("https://cdn.acme.com/static.png");
  });
});
