import { deny } from "@/lib/authz/guard";
import { gmailMailbox } from "@/lib/deploy/mailbox";
import { DEPLOYMENT_COLUMNS, deployAdmin, deployFailure, noStore, notSetUp, UUID_RE } from "@/lib/deploy/route";
import { runBatch } from "@/lib/deploy/runner";
import { dbResolver, dbStore } from "@/lib/deploy/service";
import { readServiceAccount } from "@/lib/google-dwd/token";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Works through the queue of a confirmed deployment for up to ~25 seconds (4 people at a time, with backoff when Google
 * limits requests), then answers with the progress. The screen calls it again until the deployment has finished, so a
 * closed tab or a failed request loses nothing: the queue lives in the database and any later call resumes it.
 * It can only ever touch items that are already in the deployment.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return deny(400, "bad_request", "Invalid id.");
  const a = await deployAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const sa = readServiceAccount();
  if (!sa) return notSetUp();
  try {
    const before = await supabase.from("deployments").select("id").eq("org_id", orgId).eq("id", id).maybeSingle();
    if (before.error) return deployFailure(before.error);
    if (!before.data) return deny(404, "not_found", "That deployment does not exist.");

    const batch = await runBatch({ store: dbStore(supabase, id), mailbox: gmailMailbox(sa), resolve: dbResolver(supabase, orgId) }, { concurrency: 4, budgetMs: 25_000 });
    const dep = await supabase.from("deployments").select(DEPLOYMENT_COLUMNS).eq("org_id", orgId).eq("id", id).maybeSingle();
    if (dep.error) return deployFailure(dep.error);
    return Response.json({ batch, deployment: dep.data, retryAfterMs: batch.throttled ? 8000 : 0 }, { headers: noStore });
  } catch (e) {
    return deployFailure(e);
  }
}
