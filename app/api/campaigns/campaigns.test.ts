import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op?: string; args?: unknown[]; filters: unknown[][] };

const state = vi.hoisted(() => ({
  user: { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  role: "admin",
  features: { campaigns: true, analytics: true } as Record<string, boolean>,
  queries: [] as Q[],
  rpcs: [] as { fn: string; args: unknown }[],
  answer: (() => ({ data: null, error: null })) as (q: Q) => { data: unknown; error: unknown },
}));

function builder(table: string) {
  const q: Q = { table, filters: [] };
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") {
          state.queries.push(q);
          return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(state.answer(q)).then(ok, bad);
        }
        return (...args: unknown[]) => {
          if (["select", "insert", "update", "upsert", "delete"].includes(prop)) {
            if (!q.op || (q.op === "select" && prop !== "select")) {
              q.op = prop;
              q.args = args;
            }
          } else q.filters.push([prop, ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/server", () => {
  const client = {
    from: (table: string) => builder(table),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      state.rpcs.push({ fn, args });
      if (fn === "current_app_role") return { data: state.role, error: null };
      if (fn === "feature_enabled") return { data: state.features[String(args?.p_feature)] ?? false, error: null };
      if (fn === "campaign_stats") return state.answer({ table: "rpc:campaign_stats", filters: [], args: [args] });
      return { data: null, error: null };
    },
  };
  return { createClient: async () => client, getUser: async () => state.user };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import { signToken, verifyToken } from "@/lib/campaigns/token";
import { PUT as putVariants } from "./[id]/variants/route";
import { DELETE as deleteCampaign, PATCH as patchCampaign } from "./[id]/route";
import { POST as link } from "./[id]/link/route";
import { GET as analytics } from "./analytics/route";
import { POST as render } from "./render/route";
import { GET as list, POST as create } from "./route";
import { DELETE as deleteDisc, PATCH as patchDisc } from "../disclaimers/[id]/route";
import { GET as listDisc, POST as createDisc } from "../disclaimers/route";

const ORG = "6f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const OTHER_ORG = "7f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const ID = "8f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://app.test${url}`, { method, headers: { "content-type": "application/json", host: "app.test", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const writes = () => state.queries.filter((q) => q.op && q.op !== "select");
const memberships = (q: Q) => (q.table === "memberships" ? { data: [{ org_id: ORG }], error: null } : null);

const campaignBody = { name: "Spring", href: "https://acme.com/sale", fallback_src: "https://cdn.acme.com/f.png" };
const variantsBody = { variants: [{ image_url: "https://cdn.acme.com/a.png", weight: 1 }, { image_url: "https://cdn.acme.com/b.png", weight: 1 }] };
const DAY = "from=2026-06-01&to=2026-06-30";

beforeEach(() => {
  state.user = { id: "admin-1", email: "boss@example.com", email_confirmed_at: "x" };
  state.role = "admin";
  state.features = { campaigns: true, analytics: true };
  state.queries = [];
  state.rpcs = [];
  state.answer = (q) => memberships(q) ?? { data: [{ id: ID }], error: null };
  process.env.CAMPAIGN_TOKEN_SECRET = "k".repeat(40);
  delete process.env.CAMPAIGN_BASE_URL;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const ROUTES = [
  ["GET /campaigns", () => list(req("/api/campaigns", "GET")), false],
  ["POST /campaigns", () => create(req("/api/campaigns", "POST", campaignBody)), true],
  ["PATCH /campaigns/:id", () => patchCampaign(req("/x", "PATCH", { status: "paused" }), params()), true],
  ["DELETE /campaigns/:id", () => deleteCampaign(req("/x", "DELETE"), params()), true],
  ["PUT /campaigns/:id/variants", () => putVariants(req("/x", "PUT", variantsBody), params()), true],
  ["POST /campaigns/:id/link", () => link(req("/x", "POST", {}), params()), true],
  ["GET /campaigns/analytics", () => analytics(req(`/api/campaigns/analytics?${DAY}`, "GET")), false],
  ["POST /disclaimers", () => createDisc(req("/api/disclaimers", "POST", { title: "t", category: "legal", body: "b" })), true],
  ["PATCH /disclaimers/:id", () => patchDisc(req("/x", "PATCH", { title: "t" }), params()), true],
  ["DELETE /disclaimers/:id", () => deleteDisc(req("/x", "DELETE"), params()), true],
] as const;
const FLAGGED = new Set(["GET /campaigns", "POST /campaigns", "PATCH /campaigns/:id", "DELETE /campaigns/:id", "PUT /campaigns/:id/variants", "POST /campaigns/:id/link", "GET /campaigns/analytics"]);

describe.each(ROUTES)("%s: access control", (name, call) => {
  it("is 401 signed out", async () => {
    state.user = null;
    expect((await call()).status).toBe(401);
    expect(writes()).toHaveLength(0);
  });

  it.each(["member", "designer"])("is 403 for a %s and writes nothing", async (role) => {
    state.role = role;
    expect((await call()).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it("is 403 for an admin of no organization", async () => {
    state.answer = (q) => (q.table === "memberships" ? { data: [], error: null } : { data: [{ id: ID }], error: null });
    expect((await call()).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  if (FLAGGED.has(name)) {
    it("is 403 when the feature flag is off", async () => {
      state.features = { campaigns: false, analytics: false };
      const res = await call();
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "feature_disabled" });
      expect(writes()).toHaveLength(0);
    });
  }
});

describe("writes refuse a cross-site request", () => {
  it.each([
    ["create", () => create(req("/x", "POST", campaignBody, { origin: "https://evil.example" }))],
    ["patch", () => patchCampaign(req("/x", "PATCH", { status: "paused" }, { origin: "https://evil.example" }), params())],
    ["delete", () => deleteCampaign(req("/x", "DELETE", undefined, { origin: "https://evil.example" }), params())],
    ["variants", () => putVariants(req("/x", "PUT", variantsBody, { origin: "https://evil.example" }), params())],
    ["disclaimer", () => createDisc(req("/x", "POST", { title: "t", category: "legal", body: "b" }, { origin: "https://evil.example" }))],
    ["render", () => render(req("/x", "POST", {}, { origin: "https://evil.example" }))],
  ])("%s", async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "bad_origin" });
    expect(writes()).toHaveLength(0);
  });
});

describe("campaign writes", () => {
  it("creates in the admin's own organization, ignoring a client-chosen org they do not administer", async () => {
    state.answer = (q) => memberships(q) ?? { data: { id: ID }, error: null };
    expect((await create(req("/x", "POST", { ...campaignBody, org_id: OTHER_ORG }))).status).toBe(403);
    expect(writes()).toHaveLength(0);
    const ok = await create(req("/x", "POST", { ...campaignBody, org_id: ORG }));
    expect(ok.status).toBe(201);
    expect(writes()[0]).toMatchObject({ table: "banner_campaigns", op: "insert" });
    expect((writes()[0].args![0] as Record<string, unknown>).org_id).toBe(ORG);
    expect((writes()[0].args![0] as Record<string, unknown>).created_by).toBe("admin-1");
  });

  it.each([
    ["javascript link", { ...campaignBody, href: "javascript:alert(1)" }],
    ["http link", { ...campaignBody, href: "http://acme.com" }],
    ["credentials in link", { ...campaignBody, href: "https://u:p@acme.com" }],
    ["empty name", { ...campaignBody, name: " " }],
    ["end before start", { ...campaignBody, starts_at: "2026-02-01T00:00:00Z", ends_at: "2026-01-01T00:00:00Z" }],
    ["bad status", { ...campaignBody, status: "deleted" }],
  ])("rejects %s", async (_n, body) => {
    const res = await create(req("/x", "POST", body));
    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("rejects a non-JSON body and an id that is not a uuid", async () => {
    expect((await create(req("/x", "POST", "not json"))).status).toBe(400);
    expect((await patchCampaign(req("/x", "PATCH", { status: "paused" }), params("../etc"))).status).toBe(404);
  });

  it("pauses a campaign, scoped to the admin's organization; 404 when nothing matched", async () => {
    expect((await patchCampaign(req("/x", "PATCH", { status: "paused" }), params())).status).toBe(200);
    const w = writes()[0];
    expect(w.args![0]).toEqual({ status: "paused" });
    expect(w.filters).toEqual(expect.arrayContaining([["eq", "id", ID], ["eq", "org_id", ORG]]));
    state.answer = (q) => memberships(q) ?? { data: [], error: null };
    expect((await patchCampaign(req("/x", "PATCH", { status: "paused" }), params())).status).toBe(404);
    expect((await deleteCampaign(req("/x", "DELETE"), params())).status).toBe(404);
  });

  it("never lets a variant list move another campaign's variant", async () => {
    const other = "9f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
    const mine = "af1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";
    state.answer = (q) => {
      if (q.table === "memberships") return { data: [{ org_id: ORG }], error: null };
      if (q.table === "banner_campaigns") return { data: { id: ID }, error: null };
      if (q.table === "campaign_variants" && q.op === "select") return { data: [{ id: mine }], error: null };
      return { data: null, error: null };
    };
    const res = await putVariants(req("/x", "PUT", { variants: [{ id: other, image_url: "https://a.com/1.png", weight: 1 }, { id: mine, image_url: "https://a.com/2.png", weight: 2 }] }), params());
    expect(res.status).toBe(200);
    const upsert = writes().find((q) => q.op === "upsert")!;
    expect((upsert.args![0] as { id: string }[]).map((r) => r.id)).toEqual([mine]);
    const insert = writes().find((q) => q.op === "insert")!;
    expect((insert.args![0] as Record<string, unknown>[])[0]).not.toHaveProperty("id");
  });

  it("rejects more than 8 variants, a non-https image and all-zero weights", async () => {
    const v = (n: number) => ({ image_url: "https://a.com/x.png", weight: n });
    for (const body of [{ variants: Array.from({ length: 9 }, () => v(1)) }, { variants: [{ image_url: "http://a.com/x.png", weight: 1 }] }, { variants: [v(0), v(0)] }]) {
      expect((await putVariants(req("/x", "PUT", body), params())).status).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });
});

describe("tracked link", () => {
  it("returns signed click and image links built from the stored values, never from the request", async () => {
    state.answer = (q) => memberships(q) ?? { data: { id: ID, href: "https://acme.com/stored", fallback_src: "https://cdn.acme.com/stored.png" }, error: null };
    const res = await link(req("/x", "POST", {}), params());
    const j = await res.json();
    expect(j.click_url.startsWith("http://app.test/r/")).toBe(true);
    expect(verifyToken(j.click_url.split("/r/")[1], "k".repeat(40), "r")).toMatchObject({ c: ID, h: "https://acme.com/stored" });
    expect(verifyToken(j.image_url.split("/b/")[1], "k".repeat(40), "b")).toMatchObject({ c: ID, f: "https://cdn.acme.com/stored.png" });
    expect(j.warning).toBeNull();
    process.env.CAMPAIGN_BASE_URL = "http://localhost:3200/";
    const local = await (await link(req("/x", "POST", {}), params())).json();
    expect(local.click_url.startsWith("http://localhost:3200/r/")).toBe(true);
    expect(local.warning).toMatch(/CAMPAIGN_BASE_URL/);
  });

  it("is 503 without CAMPAIGN_TOKEN_SECRET", async () => {
    delete process.env.CAMPAIGN_TOKEN_SECRET;
    expect((await link(req("/x", "POST", {}), params())).status).toBe(503);
  });
});

describe("analytics", () => {
  it("returns totals and csv for the admin's organization only", async () => {
    state.answer = (q) => {
      if (q.table === "memberships") return { data: [{ org_id: ORG }], error: null };
      if (q.table === "rpc:campaign_stats") return { data: [{ campaign_id: ID, variant_id: null, day: "2026-06-02", clicks: 2, unique_clicks: 2, image_loads: 9 }], error: null };
      return { data: [{ id: ID, name: "=cmd|calc", campaign_variants: [] }], error: null };
    };
    const json = await (await analytics(req(`/api/campaigns/analytics?${DAY}`, "GET"))).json();
    expect(json.totals[0]).toMatchObject({ clicks: 2, imageLoads: 9 });
    expect(state.rpcs.find((r) => r.fn === "campaign_stats")?.args).toEqual({ p_org: ORG, p_from: "2026-06-01", p_to: "2026-06-30" });
    const csv = await analytics(req(`/api/campaigns/analytics?${DAY}&format=csv`, "GET"));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("'=cmd|calc");
  });

  it("refuses a bad or huge date range and an organization the admin does not run", async () => {
    for (const q of ["from=2026-06-30&to=2026-06-01", "from=nope&to=2026-06-01", "from=2020-01-01&to=2026-06-01", `${DAY}&org_id=${OTHER_ORG}`]) {
      const res = await analytics(req(`/api/campaigns/analytics?${q}`, "GET"));
      expect([400, 403]).toContain(res.status);
    }
    expect(state.rpcs.filter((r) => r.fn === "campaign_stats")).toHaveLength(0);
  });
});

describe("POST /campaigns/render", () => {
  const doc = { version: 1, template_id: "classic", theme: { primary: "#112233", text: "#000000" }, blocks: [{ type: "banner", src: "https://cdn.acme.com/s.png", href: "https://acme.com/x", track: true, campaign_id: ID }] };
  const SIG = "bf1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f";

  it("signs tracked banners for a signature the caller owns and a campaign they can see", async () => {
    state.answer = (q) => (q.table === "signatures" ? { data: { id: SIG }, error: null } : { data: [{ id: ID }], error: null });
    const j = await (await render(req("/x", "POST", { doc, signature_id: SIG }))).json();
    expect(j.tracked).toBe(true);
    expect(j.html).toContain("http://app.test/r/");
  });

  it("is 404 for someone else's signature and 400 for a campaign the caller cannot see", async () => {
    state.answer = (q) => (q.table === "signatures" ? { data: null, error: null } : { data: [{ id: ID }], error: null });
    expect((await render(req("/x", "POST", { doc, signature_id: SIG }))).status).toBe(404);
    state.answer = (q) => (q.table === "signatures" ? { data: { id: SIG }, error: null } : { data: [], error: null });
    expect((await render(req("/x", "POST", { doc, signature_id: SIG }))).status).toBe(400);
  });

  it("is 401 signed out and renders plain banners without the secret", async () => {
    state.user = null;
    expect((await render(req("/x", "POST", { doc, signature_id: SIG }))).status).toBe(401);
    state.user = { id: "u", email: "a@b.c", email_confirmed_at: "x" };
    delete process.env.CAMPAIGN_TOKEN_SECRET;
    state.answer = (q) => (q.table === "signatures" ? { data: { id: SIG }, error: null } : { data: [{ id: ID }], error: null });
    const j = await (await render(req("/x", "POST", { doc, signature_id: SIG }))).json();
    expect(j.tracked).toBe(false);
    expect(j.html).not.toContain("/r/");
  });
});

describe("disclaimers", () => {
  it("any signed-in person lists templates; signed out is 401", async () => {
    state.role = "member";
    state.answer = () => ({ data: [{ id: ID, org_id: null, title: "t" }], error: null });
    expect((await listDisc()).status).toBe(200);
    state.user = null;
    expect((await listDisc()).status).toBe(401);
  });

  it("creates only in the admin's organization and does not need the campaigns flag", async () => {
    state.features = { campaigns: false, analytics: false };
    state.answer = (q) => memberships(q) ?? { data: { id: ID }, error: null };
    const res = await createDisc(req("/x", "POST", { title: "Mine", category: "legal", body: "Text", org_id: ORG }));
    expect(res.status).toBe(201);
    expect((writes()[0].args![0] as Record<string, unknown>).org_id).toBe(ORG);
    expect((await createDisc(req("/x", "POST", { title: "x", category: "legal", body: "Text", org_id: OTHER_ORG }))).status).toBe(403);
  });

  it("rejects text over 1,500 characters, an unknown category, and an empty patch", async () => {
    for (const b of [{ title: "t", category: "legal", body: "x".repeat(1501) }, { title: "t", category: "weird", body: "b" }]) {
      expect((await createDisc(req("/x", "POST", b))).status).toBe(400);
    }
    expect((await patchDisc(req("/x", "PATCH", {}), params())).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("a patch only changes the fields it names", async () => {
    await patchDisc(req("/x", "PATCH", { title: "New" }), params());
    expect(writes()[0].args![0]).toEqual({ title: "New" });
  });
});

describe("token helper used by the routes", () => {
  it("cannot be forged without the secret", () => {
    const forged = signToken({ t: "r", s: ID, h: "https://evil.example/" }, "z".repeat(40));
    expect(verifyToken(forged, "k".repeat(40), "r")).toBeNull();
  });
});
