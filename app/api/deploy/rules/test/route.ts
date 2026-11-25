import { deny } from "@/lib/authz/guard";
import { deployAdmin, deployFailure, noStore } from "@/lib/deploy/route";
import { loadRulesAndTemplates } from "@/lib/deploy/service";
import { effectiveRules, evaluate, honoured, ruleSupport, type Rule } from "@/lib/rules/evaluate";
import { RuleTest } from "@/lib/rules/schema";

export const runtime = "nodejs";

/**
 * "Test it": which template wins for a person, a message kind and an audience, and what each target would actually do.
 * Read-only. The overall answer says what the rules mean; the Gmail and Exchange answers say what each target can enforce.
 */
export async function POST(req: Request) {
  const a = await deployAdmin(req, RuleTest);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const t = a.ctx.data;
  try {
    const p = await supabase.from("people").select("id, full_name, email, department").eq("org_id", orgId).eq("id", t.person_id).maybeSingle();
    if (p.error) return deployFailure(p.error);
    if (!p.data) return deny(404, "not_found", "That person does not exist.");
    const { rules, templates } = await loadRulesAndTemplates(supabase, orgId);
    const all = effectiveRules(rules.filter((r) => r.is_active), templates);
    const ctx = { department: p.data.department as string, kind: t.kind, audience: t.audience };
    const nameOf = (id: string) => templates.find((x) => x.id === id)?.name ?? "(missing template)";
    const shape = (r: Rule | null) => (r ? { rule_id: r.id, rule_name: r.name, template_id: r.template_id, template_name: nameOf(r.template_id), implicit: !!r.implicit } : null);

    const overall = evaluate(ctx, all);
    // Gmail: one signature per address, so only rules without message kind / audience can apply; the person's department decides.
    const gmail = evaluate(ctx, honoured(all, "gmail"));
    const exchange = evaluate(ctx, honoured(all, "exchange"));
    const unverified = !!exchange.winner && ruleSupport(exchange.winner, "exchange").level === "unverified";
    return Response.json(
      {
        person: { id: p.data.id, name: p.data.full_name, department: p.data.department },
        winner: shape(overall.winner),
        matched: overall.matched.map((r) => shape(r)),
        gmail: { ...shape(gmail.winner), same_as_winner: gmail.winner?.template_id === overall.winner?.template_id },
        exchange: { ...shape(exchange.winner), same_as_winner: exchange.winner?.template_id === overall.winner?.template_id, unverified },
      },
      { headers: noStore },
    );
  } catch (e) {
    return deployFailure(e);
  }
}
