import { z } from "zod";
import { deny } from "@/lib/authz/guard";
import { dryRun, MappingSchema, previewCsv, toDbRow } from "@/lib/team/people";
import { MAX_BODY_BYTES, noStore, teamAdmin, teamFailure } from "@/lib/team/route";

export const runtime = "nodejs";

const Body = z.object({
  mode: z.enum(["preview", "dry-run", "commit"]),
  csv: z.string().max(2_200_000, "The file is larger than 2 MB."),
  filename: z.string().max(200).default(""),
  mapping: MappingSchema.optional(),
  /** Commit only: import the valid rows even when other rows have errors. */
  skip_invalid: z.boolean().default(false),
});

/**
 * Three steps on the same file, each re-reading and re-validating it on the server (the browser's own checks are advisory):
 *   preview  -> headers, a few rows and a suggested column mapping
 *   dry-run  -> every row validated against the mapping and the existing directory, nothing written
 *   commit   -> the valid rows are created or updated by email in ONE database transaction, and the import is recorded
 */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return deny(413, "too_large", "The file is larger than 2 MB.");
  const a = await teamAdmin(req, Body);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { mode, csv, filename, mapping, skip_invalid } = a.ctx.data;

  if (mode === "preview") return Response.json(previewCsv(csv), { headers: noStore });
  if (!mapping) return deny(400, "bad_request", "Choose which column is which first.");

  const { data: existing, error } = await supabase.from("people").select("email").eq("org_id", orgId).limit(50000);
  if (error) return teamFailure(error);
  const result = dryRun(csv, mapping, new Set((existing ?? []).map((r: { email: string }) => r.email)));

  if (mode === "dry-run") return Response.json({ ...result, valid: undefined, preview: result.valid.slice(0, 25), validCount: result.valid.length, errors: result.errors.slice(0, 500), moreErrors: Math.max(result.errors.length - 500, 0) }, { headers: noStore });

  if (result.fatal) return deny(400, "bad_request", result.fatal);
  if (result.errors.length > 0 && !skip_invalid) return deny(400, "has_errors", `${result.rowsWithErrors} row${result.rowsWithErrors === 1 ? " has" : "s have"} errors. Fix the file, or choose to skip those rows.`);
  if (result.valid.length === 0) return deny(400, "bad_request", "There are no valid rows to import.");

  const { data, error: rpcError } = await supabase.rpc("import_people", {
    p_org: orgId,
    p_rows: result.valid.map((v) => toDbRow(v.person)),
    p_source: "csv",
    p_filename: filename,
    p_skipped: result.rowsWithErrors,
  });
  if (rpcError) return teamFailure(rpcError);
  const r = data as { import_id: string; created: number; updated: number };
  return Response.json({ ...r, skipped: result.rowsWithErrors }, { headers: noStore });
}
