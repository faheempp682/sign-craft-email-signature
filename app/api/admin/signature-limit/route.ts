import { z } from "zod";
import { adminRequest, dbFailure } from "@/lib/admin/route";
import { deny } from "@/lib/authz/guard";
import { MAX_SIGNATURE_LIMIT, SIGNATURE_LIMIT_KEY, envSignatureLimit } from "@/lib/signature-limit";

export const runtime = "nodejs";

/** PostgREST says PGRST205 (Postgres 42P01) when the table is not there: migration 0019 has not been applied. */
const missingTable = (e: { code?: string }) => e.code === "PGRST205" || e.code === "42P01";
const needsMigration = () => deny(503, "migration_needed", "This setting needs migration 0019_platform_settings.sql applied to the database first.");

/** `limit: null` removes the admin setting, so the MAX_SIGNATURES_PER_ACCOUNT environment value (or 5) applies again. */
const Body = z.object({ limit: z.number().int().min(1, "Enter 1 or more.").max(MAX_SIGNATURE_LIMIT, `Enter ${MAX_SIGNATURE_LIMIT} or fewer.`).nullable() });

/** Set how many saved signatures one account may keep. Takes effect on the next save. */
export async function PUT(req: Request) {
  const a = await adminRequest(req, Body);
  if (!a.ok) return a.response;
  const { limit } = a.ctx.data;
  const { supabase } = a.ctx.ctx;

  if (limit === null) {
    const { error } = await supabase.from("platform_settings").delete().eq("key", SIGNATURE_LIMIT_KEY);
    if (error) return missingTable(error) ? needsMigration() : dbFailure(error);
    return Response.json({ limit: envSignatureLimit(), source: "default" }, { headers: { "Cache-Control": "no-store" } });
  }
  const { error } = await supabase.from("platform_settings").upsert({ key: SIGNATURE_LIMIT_KEY, value: limit, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return missingTable(error) ? needsMigration() : dbFailure(error);
  return Response.json({ limit, source: "admin" }, { headers: { "Cache-Control": "no-store" } });
}
