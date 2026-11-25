import { deny } from "@/lib/authz/guard";
import { deployAdmin, deployFailure, noStore, UUID_RE } from "@/lib/deploy/route";
import { RulePatch } from "@/lib/rules/schema";

export const runtime = "nodejs";

const COLUMNS = "id, name, message_kind, audience, departments, priority, template_id, is_active, created_at";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return deny(400, "bad_request", "Invalid id.");
  const a = await deployAdmin(req, RulePatch);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const patch = Object.fromEntries(Object.entries(a.ctx.data).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return deny(400, "bad_request", "Nothing to change.");
  const { data, error } = await supabase.from("signature_rules").update(patch).eq("org_id", orgId).eq("id", id).select(COLUMNS).maybeSingle();
  if (error) return deployFailure(error);
  if (!data) return deny(404, "not_found", "That rule does not exist.");
  return Response.json({ rule: data }, { headers: noStore });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return deny(400, "bad_request", "Invalid id.");
  const a = await deployAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("signature_rules").delete().eq("org_id", orgId).eq("id", id).select("id");
  if (error) return deployFailure(error);
  if (!data?.length) return deny(404, "not_found", "That rule does not exist.");
  return Response.json({ ok: true }, { headers: noStore });
}
