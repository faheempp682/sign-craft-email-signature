import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { getAccessToken } from "@/lib/google/connection";
import { buildPreview } from "@/lib/google/push";
import { googleContext, googleFailure } from "@/lib/google/server";
import { SignatureDocSchema } from "@/lib/schema/document";

export const runtime = "nodejs";

const Body = z.object({ doc: SignatureDocSchema, email: z.string().trim().email().max(254) });

/**
 * Step 1 of 2. Changes nothing. Returns the new signature (rendered here, on the server), the one Gmail currently holds
 * for the chosen address, and a fingerprint of each, which step 2 must echo back.
 */
export async function POST(req: Request) {
  const g = await googleContext(req, { write: true });
  if (!g.ok) return g.response;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return deny(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  try {
    const token = await getAccessToken(g.ctx.admin, g.ctx.cfg, g.ctx.user.id);
    return Response.json(await buildPreview(token, parsed.data.doc, parsed.data.email), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return googleFailure(e);
  }
}
