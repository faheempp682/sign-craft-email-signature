import { deny, requireUser } from "./guard";
import { consumeQuota, finishUsage, localQuota, quotaDenial, refundUsage } from "./quota";
import type { AiFeature } from "./roles";
import { createClient } from "@/lib/supabase/server";

/** In-memory limits used only when Supabase is not configured (local draft mode). */
const LOCAL_LIMITS: Record<AiFeature, { perMinute: number; perDay: number }> = {
  ai_autofill: { perMinute: 8, perDay: Number(process.env.AUTOFILL_DAILY_LIMIT) || 60 },
  ai_design: { perMinute: 10, perDay: 1000 },
  ai_vision: { perMinute: 3, perDay: 20 },
};

export type AiGate = {
  ok: true;
  /** Add the token usage from each model response. */
  record(tokensIn: number, tokensOut: number): void;
  /** Call once, in a `finally`. Stores the token counts, or gives the use back if the model call never produced anything. */
  settle(): Promise<void>;
};
export type AiGateResult = AiGate | { ok: false; response: Response };

/**
 * Everything an AI route must do before spending money: require sign-in, check the feature flag, enforce the
 * per-user limits, and record the use. When Supabase is not configured at all, falls back to in-memory limits by IP.
 *
 *   const gate = await openAiGate("ai_design", req);
 *   if (!gate.ok) return gate.response;
 *   try { …call the model, gate.record(in, out)… } finally { await gate.settle(); }
 */
export async function openAiGate(feature: AiFeature, req: Request): Promise<AiGateResult> {
  const supabase = await createClient();

  if (!supabase) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const verdict = localQuota(feature, ip, LOCAL_LIMITS[feature]);
    if (verdict !== "ok") {
      const d = quotaDenial[verdict](feature);
      return { ok: false, response: deny(d.status, d.error, d.message) };
    }
    return { ok: true, record() {}, async settle() {} };
  }

  const g = await requireUser({ unauthorized: "Sign in to use the AI features." });
  if (!g.ok) return g;

  const q = await consumeQuota(g.ctx.supabase, feature);
  if (!q.allowed) {
    const d = quotaDenial[q.reason](feature);
    return { ok: false, response: deny(d.status, d.error, d.message) };
  }

  let tokensIn = 0;
  let tokensOut = 0;
  let settled = false;
  return {
    ok: true,
    record(i, o) {
      tokensIn += i;
      tokensOut += o;
    },
    async settle() {
      if (settled) return;
      settled = true;
      if (tokensIn + tokensOut > 0) await finishUsage(g.ctx.supabase, q.usageId, tokensIn, tokensOut);
      else await refundUsage(g.ctx.supabase, q.usageId);
    },
  };
}
