import { getAccessToken } from "@/lib/google/connection";
import { listSendAs } from "@/lib/google/gmail";
import { googleContext, googleFailure } from "@/lib/google/server";

export const runtime = "nodejs";

/** The addresses this Gmail account can send as. Signature text is not returned here, only whether one exists. */
export async function GET(req: Request) {
  const g = await googleContext(req);
  if (!g.ok) return g.response;
  try {
    const token = await getAccessToken(g.ctx.admin, g.ctx.cfg, g.ctx.user.id);
    const list = await listSendAs(token);
    const addresses = list
      .map((a) => ({ email: a.email, displayName: a.displayName, isPrimary: a.isPrimary, isDefault: a.isDefault, hasSignature: a.signature.trim().length > 0, canEdit: a.canEdit }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.email.localeCompare(b.email));
    return Response.json({ addresses }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return googleFailure(e);
  }
}
