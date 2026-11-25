import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Both AI routes sit behind the same gate (sign-in, feature flag, per-user limits stored in the database).
 * These tests drive the real route handlers with a fake database and a fake model, and check that the gate is
 * enforced and that usage is recorded or given back correctly.
 */

const state = vi.hoisted(() => ({
  user: { id: "user-1", email: "u@example.com", email_confirmed_at: "x" } as null | { id: string; email: string; email_confirmed_at: string },
  quota: { allowed: true, usage_id: "use-1", remaining_day: 9 } as Record<string, unknown>,
  calls: [] as { fn: string; args?: Record<string, unknown> }[],
  model: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => {
  const client = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      if (fn === "consume_ai_quota") return { data: state.quota, error: null };
      return { data: null, error: null };
    },
  };
  return { createClient: async () => client, getUser: async () => state.user };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    messages = { create: (...a: unknown[]) => state.model(...a) };
    static AuthenticationError = class extends Error {};
    static RateLimitError = class extends Error {};
    static NotFoundError = class extends Error {};
    static APIConnectionError = class extends Error {};
  }
  return { default: Anthropic };
});

import { POST as design } from "./design/route";
import { POST as autofill } from "./autofill/route";

const post = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(new Request("http://localhost/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const called = (fn: string) => state.calls.filter((c) => c.fn === fn);

const DESIGN = { prompt: "A calm navy signature for a law firm" };
const AUTOFILL = { type: "text", text: "Jane Doe, Senior Designer at Acme Ltd. jane@acme.com +1 555 0100" };

/** The model returns text that is not valid output, but it was still called and billed. */
const modelReturnsJunk = () => state.model.mockResolvedValue({ content: [{ type: "text", text: "not json" }], stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 30 } });

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  state.user = { id: "user-1", email: "u@example.com", email_confirmed_at: "x" };
  state.quota = { allowed: true, usage_id: "use-1", remaining_day: 9 };
  state.calls = [];
  state.model = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cached answers", () => {
  it("do not count against the user: the first call is billed, the repeat is given back", async () => {
    state.model.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ facts: { name: "Jane Doe", social: [] } }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 90, output_tokens: 20 },
    });
    const text = { type: "text", text: "Jane Doe is a designer. Reach her at jane@acme.com. cache-gate-test" };
    expect((await post(autofill, text)).status).toBe(200);
    expect(called("finish_ai_usage")).toHaveLength(1);
    expect((await (await post(autofill, text)).json()).cached).toBe(true);
    expect(state.model).toHaveBeenCalledTimes(1);
    expect(called("refund_ai_usage")).toHaveLength(1);
    expect(called("finish_ai_usage")).toHaveLength(1);
  });
});

describe.each([
  ["design", design, DESIGN, "ai_design"],
  ["autofill", autofill, AUTOFILL, "ai_autofill"],
] as const)("POST /api/ai/%s", (_name, handler, body, feature) => {
  it("requires sign-in, and never reaches the model or the quota", async () => {
    state.user = null;
    const res = await post(handler, body);
    expect(res.status).toBe(401);
    expect(state.model).not.toHaveBeenCalled();
    expect(called("consume_ai_quota")).toHaveLength(0);
  });

  it("asks the database about the right feature", async () => {
    modelReturnsJunk();
    await post(handler, body);
    expect(called("consume_ai_quota")[0].args).toEqual({ p_feature: feature });
  });

  it("is 403 when the feature is switched off for the user, and the model is never called", async () => {
    state.quota = { allowed: false, reason: "feature_disabled" };
    const res = await post(handler, body);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "feature_disabled" });
    expect(state.model).not.toHaveBeenCalled();
  });

  it("is 429 at the per-minute and per-day limits, and the model is never called", async () => {
    for (const reason of ["rate_limited", "daily_limit"]) {
      state.quota = { allowed: false, reason };
      const res = await post(handler, body);
      expect(res.status).toBe(429);
      expect(await res.json()).toMatchObject({ error: reason });
    }
    expect(state.model).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when usage tracking is unavailable", async () => {
    state.quota = {}; // malformed answer
    const res = await post(handler, body);
    expect(res.status).toBe(503);
    expect(state.model).not.toHaveBeenCalled();
  });

  it("gives the use back when the request is invalid, because nothing was spent", async () => {
    const res = await post(handler, { nonsense: true });
    expect(res.status).toBe(400);
    expect(state.model).not.toHaveBeenCalled();
    expect(called("refund_ai_usage")).toHaveLength(1);
    expect(called("finish_ai_usage")).toHaveLength(0);
  });

  it("records the tokens when the model was called, even if its answer was unusable", async () => {
    modelReturnsJunk();
    const res = await post(handler, body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(state.model).toHaveBeenCalled();
    const finish = called("finish_ai_usage");
    expect(finish).toHaveLength(1);
    expect(finish[0].args).toMatchObject({ p_id: "use-1" });
    expect(Number(finish[0].args?.p_tokens_in)).toBeGreaterThanOrEqual(120);
    expect(Number(finish[0].args?.p_tokens_out)).toBeGreaterThanOrEqual(30);
    expect(called("refund_ai_usage")).toHaveLength(0);
  });

  it("gives the use back when the model call itself fails before producing anything", async () => {
    state.model.mockRejectedValue(new Error("network down"));
    const res = await post(handler, body);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(called("refund_ai_usage")).toHaveLength(1);
    expect(called("finish_ai_usage")).toHaveLength(0);
  });

  it("is 503 when the API key is missing, before any quota is used", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    const res = await post(handler, body);
    expect(res.status).toBe(503);
    expect(called("consume_ai_quota")).toHaveLength(0);
  });
});
