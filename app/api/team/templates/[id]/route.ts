import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { validateSpec } from "@/lib/team/template";
import { badId, Departments, noStore, TEMPLATE_COLUMNS, notFound, teamAdmin, teamFailure, UUID_RE } from "@/lib/team/route";

export const runtime = "nodejs";

const Patch = z
  .object({
    name: z.string().trim().min(1, "Give the template a name.").max(80),
    doc: z.unknown(),
    lock: z.unknown(),
    field_map: z.unknown(),
    departments: Departments,
    is_active: z.boolean(),
  })
  .partial()
  .strict();

/** Edit a template: name, targeting, active flag, and (validated together) the document, lock and field map. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  const a = await teamAdmin(req, Patch);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const body = a.ctx.data;
  if (Object.keys(body).length === 0) return deny(400, "bad_request", "Nothing to change.");

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.departments !== undefined) update.departments = body.departments;
  if (body.is_active !== undefined) update.is_active = body.is_active;

  if (body.doc !== undefined || body.lock !== undefined || body.field_map !== undefined) {
    const { data: current, error } = await supabase.from("brand_templates").select(TEMPLATE_COLUMNS).eq("id", id).eq("org_id", orgId).maybeSingle();
    if (error) return teamFailure(error);
    if (!current) return notFound("template");
    const merged = validateSpec({ doc: body.doc ?? current.doc_json, lock: body.lock ?? current.lock_json, field_map: body.field_map ?? current.field_map });
    if (!merged.ok) return deny(400, "bad_request", merged.error);
    update.doc_json = merged.spec.doc;
    update.lock_json = merged.spec.lock;
    update.field_map = merged.spec.field_map;
  }

  const { data, error } = await supabase.from("brand_templates").update(update).eq("id", id).eq("org_id", orgId).select("id").maybeSingle();
  if (error) return teamFailure(error);
  if (!data) return notFound("template");
  return Response.json({ id: data.id }, { headers: noStore });
}

/** Delete a template. Submitted versions keep their own copy, so history is unaffected. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  const a = await teamAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("brand_templates").delete().eq("id", id).eq("org_id", orgId).select("id");
  if (error) return teamFailure(error);
  if (!data?.length) return notFound("template");
  return Response.json({ ok: true }, { headers: noStore });
}
