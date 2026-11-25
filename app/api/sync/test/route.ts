import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { GenericConfig, HubspotConfig, type GenericConfigT, type HubspotConfigT } from "@/lib/sync/crm-config";
import { testGeneric } from "@/lib/sync/generic-crm";
import { fetchHubspot } from "@/lib/sync/hubspot";
import { loadSettings } from "@/lib/sync/run";
import { needFeature, noStore, syncAdmin, syncFailure } from "@/lib/sync/route";

export const runtime = "nodejs";

const Body = z.object({
  source: z.enum(["hubspot", "generic"]),
  email: z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address."),
  /** The mapping on screen, so it can be tried before it is saved. Omitted: the saved one. */
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The TEST button: fetch ONE record for the given email and show exactly what would be mapped. Writes nothing.
 * The secret comes from the server environment; the answer contains only the mapped values and a short list of sample paths.
 */
export async function POST(req: Request) {
  const a = await syncAdmin(req, Body);
  if (!a.ok) return a.response;
  const { source, email } = a.ctx.data;
  const blocked = await needFeature(a.ctx.ctx, source);
  if (blocked) return blocked;
  try {
    const raw = a.ctx.data.config ?? (await loadSettings(a.ctx.ctx.supabase, a.ctx.ctx.orgId, source)).config;
    const parsed = (source === "hubspot" ? HubspotConfig : GenericConfig).safeParse(raw);
    if (!parsed.success) return deny(400, "bad_config", `${parsed.error.issues[0].path.join(".") || "mapping"}: ${parsed.error.issues[0].message}`);
    if (source === "generic") {
      const r = await testGeneric(parsed.data as GenericConfigT, email);
      return Response.json({ source, found: r.found, rows: r.rows, paths: r.paths }, { headers: noStore });
    }
    const cfg = parsed.data as HubspotConfigT;
    const r = await fetchHubspot(cfg, [email]);
    const values = r.records.get(email);
    return Response.json(
      { source, found: !!values, rows: cfg.mapping.map((m) => ({ from: m.from, to: m.to, found: !!values && m.to in values, value: values?.[m.to] ?? "", note: values && !(m.to in values) ? "Ignored: too long." : values && !values[m.to] ? "HubSpot has an empty value here." : "" })), paths: [] },
      { headers: noStore },
    );
  } catch (e) {
    return syncFailure(e);
  }
}
