import { safeNext } from "@/lib/supabase/auth-utils";
import { backTo, stateCookie } from "@/lib/google/cookies";
import { buildAuthUrl } from "@/lib/google/oauth";
import { googleContext, originOf } from "@/lib/google/server";
import { newHandshake, sealState } from "@/lib/google/state";

export const runtime = "nodejs";

/**
 * Starts "Connect Google". This is a normal link the browser follows, so failures send the person back to the page
 * they came from with a short code, instead of showing raw JSON.
 */
export async function GET(req: Request) {
  const origin = originOf(req);
  const next = safeNext(new URL(req.url).searchParams.get("next"), "/preview");

  const g = await googleContext(req);
  if (!g.ok) {
    if (g.response.status === 401) return Response.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, origin), 302);
    const { error } = (await g.response.json().catch(() => ({}))) as { error?: string };
    return backTo(origin, next, error ?? "error");
  }

  const { cfg, user } = g.ctx;
  const hs = newHandshake(user.id, next);
  return new Response(null, {
    status: 302,
    headers: { Location: buildAuthUrl(cfg, hs.state, hs.verifier), "Set-Cookie": stateCookie(sealState(hs, cfg.key), origin.startsWith("https:")), "Cache-Control": "no-store" },
  });
}
