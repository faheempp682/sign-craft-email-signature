import { z } from "zod";
import { deny, requireRole, requireUser } from "@/lib/authz/guard";
import { CreateBody } from "@/lib/polish/schemas";
import { SUMMARY_COLUMNS, dbFailure, json, polishWrite, toSummary, type PolishSummary } from "@/lib/polish/route";

export const runtime = "nodejs";

const Scope = z.enum(["mine", "queue", "held"]);

/**
 * List requests. scope=mine (default): the caller's own. scope=queue: open requests waiting for a designer.
 * scope=held: requests the calling designer holds. Row-level security decides what is visible; the role check is on top.
 * Documents are never included in a list.
 */
export async function GET(req: Request) {
  const scope = Scope.safeParse(new URL(req.url).searchParams.get("scope") ?? "mine");
  if (!scope.success) return deny(400, "bad_request", "scope must be mine, queue or held.");

  const g = scope.data === "mine" ? await requireUser({ unauthorized: "Sign in first." }) : await requireRole("designer", { unauthorized: "Sign in as a designer." });
  if (!g.ok) return g.response;
  const { supabase, user } = g.ctx;

  const base = supabase.from("polish_requests").select(SUMMARY_COLUMNS);
  const q =
    scope.data === "mine"
      ? base.eq("requester_id", user.id).order("created_at", { ascending: false })
      : scope.data === "queue"
        ? base.eq("status", "requested").order("created_at", { ascending: true })
        : base.eq("designer_id", user.id).in("status", ["in_progress", "delivered"]).order("updated_at", { ascending: false });
  const { data, error } = await q.limit(100);
  if (error) return dbFailure(error);
  const items = (data ?? []).flatMap((r) => toSummary(r) ?? []) satisfies PolishSummary[];
  return json({ items });
}

/** Ask for polish on one of your saved signatures. Needs the designer_polish feature. */
export function POST(req: Request) {
  return polishWrite(req, null, {
    who: "feature",
    schema: CreateBody,
    rpc: "polish_create",
    args: (d) => ({ p_signature_id: d.signatureId, p_note: d.note, p_origin: d.origin }),
    status: 201,
  });
}
