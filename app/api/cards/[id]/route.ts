import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { cardDbFailure, cardWrite } from "@/lib/cards/route";
import { CardInputSchema, OWNER_COLUMNS } from "@/lib/cards/schema";

/** PUT replaces every editable field of one of your cards. PATCH flips published / indexable. DELETE removes it. Row security limits all of them to the owner. */

export const dynamic = "force-dynamic";

const Id = z.uuid();
const Toggle = z.object({ published: z.boolean().optional(), indexable: z.boolean().optional() }).refine((v) => v.published !== undefined || v.indexable !== undefined, "Nothing to change.");

type Ctx = { params: Promise<{ id: string }> };
const badId = () => deny(404, "not_found", "That card does not exist.");

async function update(req: Request, ctx: Ctx, schema: typeof CardInputSchema | typeof Toggle) {
  const { id } = await ctx.params;
  if (!Id.safeParse(id).success) return badId();
  const g = await cardWrite(req, schema);
  if (!g.ok) return g.response;
  const { ctx: u, data } = g.ctx;
  const { data: row, error } = await u.supabase.from("digital_cards").update(data).eq("id", id).eq("owner_id", u.user.id).select(OWNER_COLUMNS).maybeSingle();
  if (error) return cardDbFailure(error);
  if (!row) return badId(); // not yours, or gone: indistinguishable
  return Response.json({ card: row }, { headers: { "Cache-Control": "no-store" } });
}

export const PUT = (req: Request, ctx: Ctx) => update(req, ctx, CardInputSchema);
export const PATCH = (req: Request, ctx: Ctx) => update(req, ctx, Toggle);

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!Id.safeParse(id).success) return badId();
  const g = await cardWrite(req, null);
  if (!g.ok) return g.response;
  const u = g.ctx.ctx;
  const { data, error } = await u.supabase.from("digital_cards").delete().eq("id", id).eq("owner_id", u.user.id).select("id");
  if (error) return cardDbFailure(error);
  if (!data?.length) return badId();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
