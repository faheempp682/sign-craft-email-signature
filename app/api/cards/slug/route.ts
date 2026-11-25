import { z } from "zod";
import { deny, requireFeature } from "@/lib/authz/guard";
import { slugProblem } from "@/lib/cards/schema";

/** GET /api/cards/slug?slug=ada&except=<card id>: is this address valid and free? Signed-in, digital_card only. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await requireFeature("digital_card", { unauthorized: "Sign in to manage your digital cards." });
  if (!g.ok) return g.response;
  const q = new URL(req.url).searchParams;
  const slug = (q.get("slug") ?? "").trim().toLowerCase();
  const exceptRaw = q.get("except");
  const except = exceptRaw ? z.uuid().safeParse(exceptRaw) : null;
  if (except && !except.success) return deny(400, "bad_request", "Invalid card id.");

  const problem = slugProblem(slug);
  if (problem) return Response.json({ available: false, problem }, { headers: { "Cache-Control": "no-store" } });

  const { data, error } = await g.ctx.supabase.rpc("digital_card_slug_available", { p_slug: slug, p_except: except?.data ?? null });
  if (error || typeof data !== "boolean") {
    console.error("[cards] slug check failed:", error?.code);
    return deny(500, "db", "Could not check that address. Please try again.");
  }
  return Response.json({ available: data, problem: data ? null : "That address is already taken." }, { headers: { "Cache-Control": "no-store" } });
}
