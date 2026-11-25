import { z } from "zod";
import { getPreset } from "@/lib/presets";
import { defaultSpec, validateSpec } from "@/lib/team/template";
import { Departments, noStore, TEMPLATE_COLUMNS, teamAdmin, teamFailure } from "@/lib/team/route";
import { deny } from "@/lib/authz/guard";

export const runtime = "nodejs";

const Create = z.object({
  name: z.string().trim().min(1, "Give the template a name.").max(80, "Keep the name under 80 characters."),
  from: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("preset"), id: z.string().max(60) }),
    z.object({ kind: z.literal("signature"), id: z.string().uuid() }),
  ]),
  departments: Departments.default([]),
});

export async function GET(req: Request) {
  const a = await teamAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("brand_templates").select(TEMPLATE_COLUMNS).eq("org_id", orgId).order("created_at");
  if (error) return teamFailure(error);
  return Response.json({ templates: data ?? [] }, { headers: noStore });
}

/** Create a brand template from a preset or from a saved signature the admin can read (their own, or one tagged with the organization). */
export async function POST(req: Request) {
  const a = await teamAdmin(req, Create);
  if (!a.ok) return a.response;
  const { supabase, user, orgId } = a.ctx.ctx;
  const { name, from, departments } = a.ctx.data;

  let doc: unknown;
  if (from.kind === "preset") {
    doc = getPreset(from.id)?.doc;
    if (!doc) return deny(404, "not_found", "That preset does not exist.");
  } else {
    const { data, error } = await supabase.from("signatures").select("doc_json").eq("id", from.id).maybeSingle();
    if (error) return teamFailure(error);
    if (!data) return deny(404, "not_found", "That saved signature does not exist.");
    doc = data.doc_json;
  }
  // The stored document is validated again here, so a template can never hold something the renderer would refuse.
  const first = validateSpec({ doc, lock: { editable: [] }, field_map: {} });
  if (!first.ok) return deny(400, "bad_request", first.error);
  const d = defaultSpec(first.spec.doc);
  const { data, error } = await supabase
    .from("brand_templates")
    .insert({ org_id: orgId, name, doc_json: first.spec.doc, lock_json: d.lock, field_map: d.field_map, departments, created_by: user.id })
    .select("id")
    .single();
  if (error) return teamFailure(error);
  return Response.json({ id: data.id }, { status: 201, headers: noStore });
}
