import { requireFeature } from "@/lib/authz/guard";
import { cardDbFailure, cardWrite } from "@/lib/cards/route";
import { CardInputSchema, MAX_CARDS_PER_USER, OWNER_COLUMNS } from "@/lib/cards/schema";

/** GET: the signed-in person's own cards. POST: create one. Both need the digital_card feature. */

export async function GET() {
  const g = await requireFeature("digital_card", { unauthorized: "Sign in to manage your digital cards." });
  if (!g.ok) return g.response;
  const { data, error } = await g.ctx.supabase.from("digital_cards").select(OWNER_COLUMNS).eq("owner_id", g.ctx.user.id).order("created_at", { ascending: false });
  if (error) return cardDbFailure(error);
  return Response.json({ cards: data, limit: MAX_CARDS_PER_USER }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const g = await cardWrite(req, CardInputSchema);
  if (!g.ok) return g.response;
  const { ctx, data } = g.ctx;
  const { data: row, error } = await ctx.supabase
    .from("digital_cards")
    .insert({ ...data, owner_id: ctx.user.id })
    .select(OWNER_COLUMNS)
    .single();
  if (error) return cardDbFailure(error);
  return Response.json({ card: row }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
