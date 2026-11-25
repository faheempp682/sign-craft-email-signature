import { deployAdmin, deployFailure, noStore } from "@/lib/deploy/route";
import { loadRulesAndTemplates } from "@/lib/deploy/service";
import { RuleInput } from "@/lib/rules/schema";

export const runtime = "nodejs";

const RULE_COLUMNS = "id, name, message_kind, audience, departments, priority, template_id, is_active, created_at";

/** Rules, the templates they can use and the departments that exist in the directory (for the editor). */
export async function GET(req: Request) {
  const a = await deployAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  try {
    const { rules, templates } = await loadRulesAndTemplates(supabase, orgId);
    const d = await supabase.from("people").select("department").eq("org_id", orgId).neq("department", "").limit(5000);
    if (d.error) return deployFailure(d.error);
    const departments = [...new Set((d.data ?? []).map((r: { department: string }) => r.department))].sort((x, y) => x.localeCompare(y)).slice(0, 200);
    return Response.json({ rules: [...rules].sort((x, y) => y.priority - x.priority || x.created_at.localeCompare(y.created_at)), templates, departments }, { headers: noStore });
  } catch (e) {
    return deployFailure(e);
  }
}

export async function POST(req: Request) {
  const a = await deployAdmin(req, RuleInput);
  if (!a.ok) return a.response;
  const { supabase, user, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("signature_rules").insert({ ...a.ctx.data, org_id: orgId, created_by: user.id }).select(RULE_COLUMNS).single();
  if (error) return deployFailure(error);
  return Response.json({ rule: data }, { status: 201, headers: noStore });
}
