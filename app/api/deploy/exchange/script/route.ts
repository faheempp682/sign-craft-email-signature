import { z } from "zod";
import { deployAdmin, deployFailure, noStore } from "@/lib/deploy/route";
import { generateExchange, type TemplateRow } from "@/lib/deploy/exchange";
import { loadRulesAndTemplates } from "@/lib/deploy/service";
import { TEMPLATE_COLUMNS } from "@/lib/team/route";

export const runtime = "nodejs";

const Body = z.object({
  mode: z.enum(["Audit", "AuditAndNotify", "Enforce"]).default("Audit"),
  fallback: z.enum(["Wrap", "Ignore", "Reject"]).default("Ignore"),
  priority: z.union([z.literal("end"), z.number().int().min(0).max(10_000)]).default("end"),
  duplicate_guard: z.string().trim().max(100).default(""),
  /** Keep a record that a script was generated (a row in the deployment history). */
  record: z.boolean().default(false),
});

/**
 * Generates the Exchange Online PowerShell script from the approved brand templates and the rules. GENERATED, NOT RUN BY
 * SIGNCRAFT: nothing is sent to Microsoft; the admin reads the script and runs it themselves.
 */
export async function POST(req: Request) {
  const a = await deployAdmin(req, Body);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const b = a.ctx.data;
  try {
    const [{ rules }, tpl] = await Promise.all([loadRulesAndTemplates(supabase, orgId), supabase.from("brand_templates").select(TEMPLATE_COLUMNS).eq("org_id", orgId)]);
    if (tpl.error) return deployFailure(tpl.error);
    const result = generateExchange({ rules, templates: (tpl.data ?? []) as unknown as TemplateRow[], options: { mode: b.mode, fallback: b.fallback, priority: b.priority, duplicateGuard: b.duplicate_guard } });
    if (!result.ok) return Response.json({ error: "cannot_generate", message: result.errors[0], errors: result.errors }, { status: 422, headers: noStore });
    let recorded: string | null = null;
    if (b.record) {
      const r = await supabase.rpc("record_script", { p_org: orgId, p_fingerprint: result.fingerprint, p_note: `Exchange script, ${b.mode} mode, ${result.rules.length} rule(s)` });
      if (r.error) return deployFailure(r.error);
      recorded = r.data as string;
    }
    return Response.json(
      {
        generated_not_run: true,
        script: result.script,
        removal_script: result.removalScript,
        rules: result.rules,
        warnings: result.warnings,
        omitted: result.omitted,
        summary: result.summary,
        fingerprint: result.fingerprint,
        recorded,
      },
      { headers: noStore },
    );
  } catch (e) {
    return deployFailure(e);
  }
}
