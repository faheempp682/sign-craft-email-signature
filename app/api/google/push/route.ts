import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { getAccessToken } from "@/lib/google/connection";
import { pushApproved } from "@/lib/google/push";
import { googleContext, googleFailure } from "@/lib/google/server";
import { SignatureDocSchema } from "@/lib/schema/document";

export const runtime = "nodejs";

const Hash = z.string().regex(/^[a-f0-9]{32}$/, "Review the preview again.");
const Body = z.object({
  doc: SignatureDocSchema,
  email: z.string().trim().email().max(254),
  /** Must be exactly true: the person pressed the confirm button. */
  confirm: z.boolean(),
  newHash: Hash,
  currentHash: Hash,
});

/**
 * Step 2 of 2: replace the signature. Refuses unless the person confirmed AND the new signature and the existing one
 * are still exactly what the preview showed (see lib/google/push.ts). The signature that was replaced is kept in
 * gmail_push_log so it can be restored.
 */
export async function POST(req: Request) {
  const g = await googleContext(req, { write: true });
  if (!g.ok) return g.response;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return deny(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  const { doc, email, confirm, newHash, currentHash } = parsed.data;

  try {
    const token = await getAccessToken(g.ctx.admin, g.ctx.cfg, g.ctx.user.id);
    const done = await pushApproved(token, doc, email, { confirm, newHash, currentHash });

    // The signature is already changed, so a bookkeeping failure must not turn this into an error.
    const { error } = await g.ctx.admin.from("gmail_push_log").insert({
      user_id: g.ctx.user.id,
      send_as_email: done.email,
      previous_signature: done.previousSignature.slice(0, 200_000) || null,
      new_signature_hash: done.newHash,
      template_id: doc.template_id,
    });
    if (error) console.error("[google] could not log push:", error.message);
    return Response.json({ ok: true, email: done.email, logged: !error }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return googleFailure(e);
  }
}
