import { deny, requireUser, roleOf } from "@/lib/authz/guard";
import { atLeast } from "@/lib/authz/roles";
import { dbFailure, json, parseDoc, parseId, toSummary, type PolishComment, type PolishDetail, type PolishEvent } from "@/lib/polish/route";

export const runtime = "nodejs";

/**
 * One request with its documents, comments and history. Row-level security decides whether the caller may see it at all
 * (the requester, any designer while it is in the queue, the designer who holds it); anyone else gets a plain 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await parseId(params);
  if (!p.ok) return p.response;
  const g = await requireUser({ unauthorized: "Sign in first." });
  if (!g.ok) return g.response;
  const { supabase, user } = g.ctx;

  const { data: r, error } = await supabase.from("polish_requests").select("*").eq("id", p.id).maybeSingle();
  if (error) return dbFailure(error);
  const summary = r ? toSummary(r) : null;
  if (!r || !summary) return deny(404, "not_found", "That request does not exist, or it is not yours.");

  const [comments, events] = await Promise.all([
    supabase.from("polish_comments").select("id, author_id, author_role, body, created_at").eq("request_id", p.id).order("created_at", { ascending: true }),
    supabase.from("polish_events").select("id, actor_id, action, detail, created_at").eq("request_id", p.id).order("created_at", { ascending: true }),
  ]);
  if (comments.error) return dbFailure(comments.error);
  if (events.error) return dbFailure(events.error);

  const isRequester = r.requester_id === user.id;
  const isHolder = r.designer_id === user.id;
  let role;
  try {
    role = await roleOf(g.ctx);
  } catch {
    return deny(503, "authz_unavailable", "Access control is not set up yet.");
  }
  const original = parseDoc(r.original_doc);
  const delivered = parseDoc(r.delivered_doc);

  const detail: PolishDetail = {
    ...summary,
    isRequester,
    isHolder,
    canClaim: summary.status === "requested" && atLeast(role, "designer"),
    originalDoc: original,
    deliveredDoc: delivered,
    workDoc: isHolder && summary.status === "in_progress" ? (delivered ?? original) : null,
    changeNote: typeof r.change_note === "string" ? r.change_note : null,
    declineReason: typeof r.decline_reason === "string" ? r.decline_reason : null,
    hasSource: typeof r.source_signature_id === "string",
    acceptedMode: r.accepted_mode === "new" || r.accepted_mode === "replace" ? r.accepted_mode : null,
    comments: (comments.data ?? []).map(
      (c): PolishComment => ({ id: c.id, role: c.author_role === "designer" ? "designer" : "requester", mine: c.author_id === user.id, body: c.body, createdAt: c.created_at }),
    ),
    events: (events.data ?? []).map((e): PolishEvent => ({
      id: e.id,
      action: e.action,
      by: e.actor_id === r.requester_id ? "requester" : e.actor_id ? "designer" : "system",
      detail: e.detail,
      createdAt: e.created_at,
    })),
  };
  return json(detail);
}
