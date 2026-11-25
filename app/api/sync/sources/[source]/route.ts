import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { FieldPolicySchema, parseCrmConfig } from "@/lib/sync/crm-config";
import { needFeature, isSource, noStore, syncAdmin, syncFailure } from "@/lib/sync/route";
import { loadSettings, sourceStatus, SyncDbError } from "@/lib/sync/run";
import { DIRECTORY_FIELDS, isCrm, SOURCE_LABEL, type SyncSource } from "@/lib/sync/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ source: string }> };

/** One source's settings. Never contains a secret: those live in the server environment. */
export async function GET(req: Request, { params }: Ctx) {
  const { source } = await params;
  if (!isSource(source)) return deny(404, "not_found", "Unknown source.");
  const a = await syncAdmin(req, null);
  if (!a.ok) return a.response;
  const blocked = await needFeature(a.ctx.ctx, source);
  if (blocked) return blocked;
  try {
    const { supabase, orgId } = a.ctx.ctx;
    const s = await loadSettings(supabase, orgId, source);
    return Response.json({ source, label: SOURCE_LABEL[source], ...s, ...sourceStatus(source) }, { headers: noStore });
  } catch (e) {
    return syncFailure(e);
  }
}

const Body = z.object({
  enabled: z.boolean(),
  auto_apply: z.boolean(),
  allow_blank_overwrite: z.boolean(),
  field_policy: FieldPolicySchema,
  config: z.record(z.string(), z.unknown()).default({}),
});

export async function PUT(req: Request, { params }: Ctx) {
  const { source } = await params;
  if (!isSource(source)) return deny(404, "not_found", "Unknown source.");
  const a = await syncAdmin(req, Body);
  if (!a.ok) return a.response;
  const blocked = await needFeature(a.ctx.ctx, source);
  if (blocked) return blocked;
  const { supabase, user, orgId } = a.ctx.ctx;
  const d = a.ctx.data;

  // Directory sources have no mapping to store. CRM sources must have a valid one before they can be switched on.
  let config: Record<string, unknown> = {};
  if (isCrm(source)) {
    const parsed = parseCrmConfig(source, d.config);
    if (!parsed.ok) {
      if (d.enabled || d.auto_apply || Object.keys(d.config).length) return deny(400, "bad_request", parsed.message);
    } else config = parsed.config as unknown as Record<string, unknown>;
  }
  // A policy may only name fields this source can fill.
  const allowed = new Set<string>(isCrm(source) ? [] : DIRECTORY_FIELDS);
  if (isCrm(source)) for (const m of (config.mapping as { to: string }[] | undefined) ?? []) allowed.add(m.to);
  for (const k of Object.keys(d.field_policy)) if (!allowed.has(k)) return deny(400, "bad_request", `"${k}" is not a field ${SOURCE_LABEL[source as SyncSource]} fills.`);
  if (d.auto_apply && !d.enabled) return deny(400, "bad_request", "Switch the source on before turning on auto-apply.");

  const { error } = await supabase.from("sync_sources").upsert({
    org_id: orgId,
    source,
    enabled: d.enabled,
    auto_apply: d.auto_apply,
    allow_blank_overwrite: d.allow_blank_overwrite,
    field_policy: d.field_policy,
    config,
    updated_by: user.id,
  });
  if (error) return syncFailure(new SyncDbError(error.code ?? "", error.message));
  return Response.json({ ok: true }, { headers: noStore });
}
