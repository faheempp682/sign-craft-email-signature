import { beforeEach, describe, expect, it, vi } from "vitest";
import { png } from "@/lib/storage/test-fixtures";

vi.setConfig({ testTimeout: 60_000 });

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
      return fn === "consume_ai_quota" ? { data: state.quota, error: null } : { data: null, error: null };
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

import Anthropic from "@anthropic-ai/sdk";
import { POST } from "./route";

const called = (fn: string) => state.calls.filter((c) => c.fn === fn);
const GOOD_DOC = {
  version: 1,
  template_id: "classic",
  theme: { primary: "#1E3A8A", text: "#111827", muted: "#6B7280", font: "Arial", spacing: "normal" },
  blocks: [{ type: "identity", name: "Jane Doe", title: "Designer", company: "Acme" }],
};
const modelReplies = (text: string, usage = { input_tokens: 1500, output_tokens: 300 }) =>
  state.model.mockResolvedValue({ content: [{ type: "text", text }], stop_reason: "end_turn", usage });

let n = 0;
/** Each call gets a different picture so the answer cache does not bleed between tests. */
const send = async (opts: { file?: Uint8Array | null; note?: string; type?: string; headers?: Record<string, string> } = {}) => {
  const form = new FormData();
  const bytes = opts.file === undefined ? await png(200 + ++n, 80) : opts.file;
  if (bytes) form.set("file", new File([bytes as BlobPart], "shot.png", { type: opts.type ?? "image/png" }));
  if (opts.note !== undefined) form.set("note", opts.note);
  return POST(new Request("http://localhost/api/ai/vision", { method: "POST", body: form, headers: opts.headers }));
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.ANTHROPIC_VISION_MODEL;
  state.user = { id: "user-1", email: "u@example.com", email_confirmed_at: "x" };
  state.quota = { allowed: true, usage_id: "use-1", remaining_day: 9 };
  state.calls = [];
  state.model = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/ai/vision: access", () => {
  it("requires sign-in, and never reaches the quota or the model", async () => {
    state.user = null;
    expect((await send()).status).toBe(401);
    expect(called("consume_ai_quota")).toHaveLength(0);
    expect(state.model).not.toHaveBeenCalled();
  });

  it("checks the ai_vision feature", async () => {
    modelReplies(JSON.stringify({ reply: "ok", doc: GOOD_DOC }));
    await send();
    expect(called("consume_ai_quota")[0].args).toEqual({ p_feature: "ai_vision" });
  });

  it("is 403 when the feature is off for this person", async () => {
    state.quota = { allowed: false, reason: "feature_disabled" };
    const res = await send();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "feature_disabled" });
    expect(state.model).not.toHaveBeenCalled();
  });

  it.each(["rate_limited", "daily_limit"])("is 429 at the %s limit", async (reason) => {
    state.quota = { allowed: false, reason };
    const res = await send();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: reason });
    expect(state.model).not.toHaveBeenCalled();
  });

  it("is 503 without an API key, before any quota is used", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    expect((await send()).status).toBe(503);
    expect(called("consume_ai_quota")).toHaveLength(0);
  });
});

describe("POST /api/ai/vision: bad input never spends quota or reaches the model", () => {
  const refunded = () => {
    expect(state.model).not.toHaveBeenCalled();
    expect(called("refund_ai_usage")).toHaveLength(1);
    expect(called("finish_ai_usage")).toHaveLength(0);
  };

  it("no file", async () => {
    expect((await send({ file: null })).status).toBe(400);
    refunded();
  });

  it("a file that is not an image, whatever its declared type", async () => {
    const res = await send({ file: new TextEncoder().encode("<svg></svg>"), type: "image/png" });
    expect(res.status).toBe(415);
    refunded();
  });

  it("an oversize screenshot", async () => {
    expect((await send({ file: new Uint8Array(5 * 1024 * 1024 + 1) })).status).toBe(413);
    refunded();
  });

  it("a declared body size far over the limit is refused before it is read", async () => {
    expect((await send({ headers: { "content-length": String(50 * 1024 * 1024) } })).status).toBe(413);
    refunded();
  });

  it("a note that is too long", async () => {
    expect((await send({ note: "x".repeat(501) })).status).toBe(400);
    refunded();
  });
});

describe("POST /api/ai/vision: reading a screenshot", () => {
  it("returns the rebuilt document and records the tokens", async () => {
    modelReplies(JSON.stringify({ reply: "I rebuilt it.", doc: GOOD_DOC }));
    const res = await send({ note: "keep it navy" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ reply: "I rebuilt it.", cached: false, doc: { template_id: "classic" } });
    expect(called("finish_ai_usage")[0].args).toEqual({ p_id: "use-1", p_tokens_in: 1500, p_tokens_out: 300 });
    expect(called("refund_ai_usage")).toHaveLength(0);
  });

  it("sends the picture to the vision model with a cacheable system prompt", async () => {
    modelReplies(JSON.stringify({ reply: "ok", doc: GOOD_DOC }));
    await send({ note: "keep it navy" });
    const req = state.model.mock.calls[0][0];
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.system[0]).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(req.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });
    expect(req.messages[0].content[1].text).toContain("keep it navy");
  });

  it("honours ANTHROPIC_VISION_MODEL", async () => {
    vi.resetModules();
    process.env.ANTHROPIC_VISION_MODEL = "claude-opus-5-5";
    const { POST: fresh } = await import("./route");
    modelReplies(JSON.stringify({ reply: "ok", doc: GOOD_DOC }));
    const form = new FormData();
    form.set("file", new File([(await png(333, 66)) as BlobPart], "s.png", { type: "image/png" }));
    await fresh(new Request("http://localhost/api/ai/vision", { method: "POST", body: form }));
    expect(state.model.mock.calls[0][0].model).toBe("claude-opus-5-5");
  });

  it("answers the same picture and note from the cache, and gives the repeat back to the quota", async () => {
    modelReplies(JSON.stringify({ reply: "ok", doc: GOOD_DOC }));
    const same = await png(410, 90);
    expect((await (await send({ file: same, note: "a" })).json()).cached).toBe(false);
    expect((await (await send({ file: same, note: "a" })).json()).cached).toBe(true);
    expect(state.model).toHaveBeenCalledTimes(1);
    expect(called("finish_ai_usage")).toHaveLength(1);
    expect(called("refund_ai_usage")).toHaveLength(1);
    // a different note is a different request
    await send({ file: same, note: "b" });
    expect(state.model).toHaveBeenCalledTimes(2);
  });

  it("tells the user when the picture is not a signature, and still bills the call that was made", async () => {
    modelReplies(JSON.stringify({ reply: "This is a landscape photo.", doc: null }));
    const res = await send();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "not_signature" });
    expect(called("finish_ai_usage")).toHaveLength(1);
    expect(called("refund_ai_usage")).toHaveLength(0);
  });

  it("records tokens for every attempt when the first answer was invalid", async () => {
    state.model
      .mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 50 } })
      .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify({ reply: "ok", doc: GOOD_DOC }) }], stop_reason: "end_turn", usage: { input_tokens: 1100, output_tokens: 200 } });
    expect((await send()).status).toBe(200);
    expect(called("finish_ai_usage")[0].args).toMatchObject({ p_tokens_in: 2100, p_tokens_out: 250 });
  });

  it("gives the use back when the model call fails before producing anything", async () => {
    state.model.mockRejectedValue(new Error("network down"));
    expect((await send()).status).toBe(502);
    expect(called("refund_ai_usage")).toHaveLength(1);
    expect(called("finish_ai_usage")).toHaveLength(0);
  });

  it("maps SDK failures to specific messages", async () => {
    const err = (C: unknown) => new (C as new (m: string) => Error)("x");
    state.model.mockRejectedValueOnce(err(Anthropic.AuthenticationError));
    expect(await (await send()).json()).toMatchObject({ error: "auth" });
    state.model.mockRejectedValueOnce(err(Anthropic.RateLimitError));
    expect((await send()).status).toBe(429);
    state.model.mockRejectedValueOnce(err(Anthropic.NotFoundError));
    expect(await (await send()).json()).toMatchObject({ error: "model" });
    state.model.mockRejectedValueOnce(err(Anthropic.APIConnectionError));
    expect(await (await send()).json()).toMatchObject({ error: "network" });
  });

  it("never writes the note to the logs when something unexpected fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.model.mockRejectedValue(new Error("boom"));
    await send({ note: "TOP-SECRET-NOTE" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("TOP-SECRET");
  });
});
