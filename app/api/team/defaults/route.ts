import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { noStore, teamAdmin, teamFailure, UUID_RE } from "@/lib/team/route";

export const runtime = "nodejs";

const Body = z.object({
  /** Exactly true: the admin pressed the confirm button. */
  confirm: z.literal(true, { error: "Confirm first. Nothing was changed." }),
  /** Omit for every active person without an approved signature. */
  person_ids: z.array(z.string().regex(UUID_RE)).min(1).max(1000).optional(),
});

/**
 * Approve the brand template's signature for people who have none yet (typically people from a CSV or a directory sync
 * who have never signed in). Never replaces an existing approved signature. Bulk deploy then has something to deploy.
 */
export async function POST(req: Request) {
  const a = await teamAdmin(req, Body);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.rpc("approve_directory_defaults", { p_org: orgId, p_person_ids: a.ctx.data.person_ids ?? null });
  if (error) return teamFailure(error);
  const r = data as { created?: number; already_approved?: number; no_template?: number } | null;
  if (!r || typeof r.created !== "number") return deny(500, "db", "Could not approve the signatures. Please try again.");
  return Response.json({ created: r.created, already_approved: r.already_approved ?? 0, no_template: r.no_template ?? 0 }, { headers: noStore });
}
