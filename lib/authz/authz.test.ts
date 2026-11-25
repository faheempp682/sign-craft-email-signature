import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  user: null as null | { id: string; email: string; email_confirmed_at: string | null },
  role: "member" as string | null, // null makes current_app_role fail
  feature: true as boolean | "error",
  quota: { allowed: true, usage_id: "u1", remaining_day: 5 } as unknown,
  quotaError: false,
  adminKey: true,
  upserts: [] as Record<string, unknown>[],
  calls: [] as { fn: string; args?: Record<string, unknown> }[],
}));

const supabase = {
  rpc: async (fn: string, args?: Record<string, unknown>) => {
    state.calls.push({ fn, args });
    switch (fn) {
      case "current_app_role":
        return state.role === null ? { data: null, error: { message: "function does not exist" } } : { data: state.role, error: null };
      case "feature_enabled":
        return state.feature === "error" ? { data: null, error: { message: "boom" } } : { data: state.feature, error: null };
      case "consume_ai_quota":
        return state.quotaError ? { data: null, error: { message: "boom" } } : { data: state.quota, error: null };
      default:
        return { data: null, error: null };
    }
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => (state.configured ? supabase : null),
  getUser: async () => state.user,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    state.adminKey
      ? {
          from: (table: string) => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "organizations" ? { id: "org-1" } : null, error: null }) }) }),
            upsert: async (row: Record<string, unknown>) => {
              state.upserts.push(row);
              if (row.role === "admin") state.role = "admin"; // the real database would now report admin
              return { error: null };
            },
          }),
        }
      : null,
}));

import { adminEmails, isBootstrapAdmin, promoteToAdmin } from "./bootstrap";
import { consumeQuota, finishUsage, localQuota, refundUsage } from "./quota";
import { openAiGate } from "./ai-gate";
import { featureEnabled, requireFeature, requireRole, requireUser } from "./guard";
import { AI_FEATURES, FEATURES, atLeast, isAiFeature, isFeature, isRole } from "./roles";

const alice = { id: "alice", email: "alice@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" };
const body = async (r: Response) => ({ status: r.status, ...(await r.json()) });
const called = (fn: string) => state.calls.filter((c) => c.fn === fn);

beforeEach(() => {
  state.configured = true;
  state.user = alice;
  state.role = "member";
  state.feature = true;
  state.quota = { allowed: true, usage_id: "u1", remaining_day: 5 };
  state.quotaError = false;
  state.adminKey = true;
  state.upserts = [];
  state.calls = [];
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAIL;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("roles and features", () => {
  it("orders member < designer < admin", () => {
    expect(atLeast("admin", "member")).toBe(true);
    expect(atLeast("admin", "admin")).toBe(true);
    expect(atLeast("designer", "member")).toBe(true);
    expect(atLeast("designer", "admin")).toBe(false);
    expect(atLeast("member", "designer")).toBe(false);
  });

  it("validates role and feature names", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isFeature("ai_design")).toBe(true);
    expect(isFeature("constructor")).toBe(false);
    expect(isAiFeature("animated_gif")).toBe(false);
    expect(AI_FEATURES.every((f) => f in FEATURES)).toBe(true);
  });
});

describe("requireUser", () => {
  it("returns the user and client when signed in", async () => {
    const g = await requireUser();
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.ctx.user.id).toBe("alice");
  });

  it("is 401 when signed out, with the route's own message", async () => {
    state.user = null;
    const g = await requireUser({ unauthorized: "Sign in to save signatures." });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(await body(g.response)).toEqual({ status: 401, error: "unauthorized", message: "Sign in to save signatures." });
  });

  it("is 503 when Supabase is not configured", async () => {
    state.configured = false;
    const g = await requireUser();
    if (!g.ok) expect((await body(g.response)).status).toBe(503);
    expect(g.ok).toBe(false);
  });
});

describe("requireRole", () => {
  it("lets an admin through and reports the role", async () => {
    state.role = "admin";
    const g = await requireRole("admin");
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.ctx.role).toBe("admin");
  });

  it("is 403 for a lower role", async () => {
    for (const role of ["member", "designer"]) {
      state.role = role;
      const g = await requireRole("admin");
      expect(g.ok).toBe(false);
      if (!g.ok) expect(await body(g.response)).toMatchObject({ status: 403, error: "forbidden" });
    }
  });

  it("designer passes a designer requirement", async () => {
    state.role = "designer";
    expect((await requireRole("designer")).ok).toBe(true);
  });

  it("is 401 when signed out, and never reads a role", async () => {
    state.user = null;
    const g = await requireRole("admin");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(401);
    expect(called("current_app_role")).toHaveLength(0);
  });

  it("fails closed with 503 when the role cannot be read", async () => {
    state.role = null;
    const g = await requireRole("member");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(await body(g.response)).toMatchObject({ status: 503, error: "authz_unavailable" });
  });
});

describe("first-admin bootstrap", () => {
  it("parses ADMIN_EMAILS (and the older ADMIN_EMAIL), ignoring case and spaces", () => {
    expect(adminEmails({ ADMIN_EMAILS: " A@x.com, b@y.com ,," })).toEqual(["a@x.com", "b@y.com"]);
    expect(adminEmails({ ADMIN_EMAIL: "Solo@X.com" })).toEqual(["solo@x.com"]);
    expect(adminEmails({ ADMIN_EMAILS: "a@x.com", ADMIN_EMAIL: "b@x.com" })).toEqual(["a@x.com"]);
    expect(adminEmails({})).toEqual([]);
  });

  it("only a CONFIRMED listed email counts", () => {
    const list = ["alice@example.com"];
    expect(isBootstrapAdmin({ email: "Alice@Example.com", email_confirmed_at: "x" }, list)).toBe(true);
    expect(isBootstrapAdmin({ email: "alice@example.com", email_confirmed_at: null }, list)).toBe(false);
    expect(isBootstrapAdmin({ email: "bob@example.com", email_confirmed_at: "x" }, list)).toBe(false);
    expect(isBootstrapAdmin({ email: null, email_confirmed_at: "x" }, list)).toBe(false);
    expect(isBootstrapAdmin({ email: "alice@example.com", email_confirmed_at: "x" }, [])).toBe(false);
  });

  it("promotes a listed, confirmed user to admin on their first request", async () => {
    process.env.ADMIN_EMAILS = "alice@example.com";
    const g = await requireRole("admin");
    expect(g.ok).toBe(true);
    expect(state.upserts).toEqual([{ org_id: "org-1", user_id: "alice", role: "admin" }]);
  });

  it("does nothing for users who are not listed", async () => {
    process.env.ADMIN_EMAILS = "someone-else@example.com";
    const g = await requireRole("admin");
    expect(g.ok).toBe(false);
    expect(state.upserts).toEqual([]);
  });

  it("does not promote an unconfirmed email, even if listed", async () => {
    process.env.ADMIN_EMAILS = "alice@example.com";
    state.user = { ...alice, email_confirmed_at: null };
    expect((await requireRole("admin")).ok).toBe(false);
    expect(state.upserts).toEqual([]);
  });

  it("without the service-role key a listed user stays a member (and a warning is logged)", async () => {
    process.env.ADMIN_EMAILS = "alice@example.com";
    state.adminKey = false;
    expect((await requireRole("admin")).ok).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it("does not touch the admin client for users who are already admins", async () => {
    process.env.ADMIN_EMAILS = "alice@example.com";
    state.role = "admin";
    expect((await requireRole("admin")).ok).toBe(true);
    expect(state.upserts).toEqual([]);
  });

  it("reports failure when the default organization is missing", async () => {
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: async () => ({ error: null }),
      }),
    };
    expect(await promoteToAdmin(db as never, "alice")).toBe(false);
  });
});

describe("requireFeature", () => {
  it("passes when the feature is on and asks the database about that feature", async () => {
    const g = await requireFeature("gmail_push");
    expect(g.ok).toBe(true);
    expect(called("feature_enabled")[0].args).toEqual({ p_feature: "gmail_push" });
  });

  it("is 403 feature_disabled, naming the feature, when it is off", async () => {
    state.feature = false;
    const g = await requireFeature("animated_gif");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(await body(g.response)).toMatchObject({ status: 403, error: "feature_disabled", message: expect.stringContaining("Animated GIF") });
  });

  it("is 401 when signed out", async () => {
    state.user = null;
    const g = await requireFeature("ai_design");
    if (!g.ok) expect(g.response.status).toBe(401);
    expect(g.ok).toBe(false);
  });

  it("fails closed (503) when the check errors", async () => {
    state.feature = "error";
    const g = await requireFeature("ai_design");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(503);
    expect(await featureEnabled(supabase as never, "ai_design")).toBeNull();
  });
});

describe("consumeQuota", () => {
  it("maps an allowed result", async () => {
    expect(await consumeQuota(supabase as never, "ai_design")).toEqual({ allowed: true, usageId: "u1", remainingDay: 5 });
    expect(called("consume_ai_quota")[0].args).toEqual({ p_feature: "ai_design" });
  });

  it.each(["feature_disabled", "rate_limited", "daily_limit"])("maps %s", async (reason) => {
    state.quota = { allowed: false, reason };
    expect(await consumeQuota(supabase as never, "ai_design")).toEqual({ allowed: false, reason });
  });

  it("fails closed on errors and on anything unexpected", async () => {
    state.quotaError = true;
    expect(await consumeQuota(supabase as never, "ai_design")).toEqual({ allowed: false, reason: "unavailable" });
    state.quotaError = false;
    for (const odd of [null, "yes", {}, { allowed: true }, { allowed: false, reason: "other" }]) {
      state.quota = odd;
      expect(await consumeQuota(supabase as never, "ai_design")).toMatchObject({ allowed: false, reason: "unavailable" });
    }
  });

  it("finish and refund never throw", async () => {
    const failing = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    await expect(finishUsage(failing as never, "u", 1, 2)).resolves.toBeUndefined();
    await expect(refundUsage(failing as never, "u")).resolves.toBeUndefined();
  });
});

describe("local-development limits (Supabase not configured)", () => {
  it("limits per minute and per day, per key", () => {
    const limits = { perMinute: 2, perDay: 3 };
    expect(localQuota("ai_vision", "k1", limits)).toBe("ok");
    expect(localQuota("ai_vision", "k1", limits)).toBe("ok");
    expect(localQuota("ai_vision", "k1", limits)).toBe("rate_limited");
    expect(localQuota("ai_vision", "k2", limits)).toBe("ok");
  });
});

describe("openAiGate", () => {
  const req = () => new Request("http://localhost/x", { method: "POST" });

  it("is 401 when signed out, and spends nothing", async () => {
    state.user = null;
    const g = await openAiGate("ai_design", req());
    expect(g.ok).toBe(false);
    if (!g.ok) expect(await body(g.response)).toMatchObject({ status: 401 });
    expect(called("consume_ai_quota")).toHaveLength(0);
  });

  it.each([
    ["feature_disabled", 403, "feature_disabled"],
    ["rate_limited", 429, "rate_limited"],
    ["daily_limit", 429, "daily_limit"],
  ])("turns %s into %i", async (reason, status, error) => {
    state.quota = { allowed: false, reason };
    const g = await openAiGate("ai_design", req());
    expect(g.ok).toBe(false);
    if (!g.ok) expect(await body(g.response)).toMatchObject({ status, error });
  });

  it("is 503 when usage tracking is unavailable (never an unmetered pass)", async () => {
    state.quotaError = true;
    const g = await openAiGate("ai_design", req());
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(503);
  });

  it("stores the token counts when the model was used", async () => {
    const g = await openAiGate("ai_design", req());
    if (!g.ok) throw new Error("expected allowed");
    g.record(100, 40);
    g.record(10, 5);
    await g.settle();
    expect(called("finish_ai_usage")[0].args).toEqual({ p_id: "u1", p_tokens_in: 110, p_tokens_out: 45 });
    expect(called("refund_ai_usage")).toHaveLength(0);
  });

  it("gives the use back when the model never produced anything", async () => {
    const g = await openAiGate("ai_design", req());
    if (!g.ok) throw new Error("expected allowed");
    await g.settle();
    expect(called("refund_ai_usage")[0].args).toEqual({ p_id: "u1" });
    expect(called("finish_ai_usage")).toHaveLength(0);
  });

  it("settles only once", async () => {
    const g = await openAiGate("ai_design", req());
    if (!g.ok) throw new Error("expected allowed");
    await g.settle();
    await g.settle();
    expect(called("refund_ai_usage")).toHaveLength(1);
  });

  it("falls back to in-memory limits only when Supabase is not configured", async () => {
    state.configured = false;
    state.user = null;
    const headers = { "x-forwarded-for": "203.0.113.9" };
    const open = () => openAiGate("ai_vision", new Request("http://localhost/x", { headers }));
    for (let i = 0; i < 3; i++) expect((await open()).ok).toBe(true); // ai_vision: 3 per minute locally
    const fourth = await open();
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.response.status).toBe(429);
    expect(called("consume_ai_quota")).toHaveLength(0);
  });
});
