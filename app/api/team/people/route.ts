import { z } from "zod";
import { normalizePerson, PersonInput } from "@/lib/team/people";
import { noStore, PERSON_COLUMNS, teamAdmin, teamFailure } from "@/lib/team/route";

export const runtime = "nodejs";

/** Escape a user's search text for use inside a PostgREST `ilike` filter. */
const likeSafe = (s: string) => s.replace(/[\\%_,()*]/g, " ").trim().slice(0, 80);

/** The organization's people: search, filters and counts. */
export async function GET(req: Request) {
  const a = await teamAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const url = new URL(req.url);
  const q = likeSafe(url.searchParams.get("q") ?? "");
  const department = (url.searchParams.get("department") ?? "").slice(0, 80);
  const source = url.searchParams.get("source") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  let query = supabase.from("people").select(PERSON_COLUMNS, { count: "exact" }).eq("org_id", orgId).order("full_name").range(offset, offset + limit - 1);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,title.ilike.%${q}%`);
  if (department) query = query.eq("department", department);
  if (["manual", "csv", "google", "microsoft", "crm"].includes(source)) query = query.eq("source", source);
  if (status === "active" || status === "inactive") query = query.eq("status", status);
  const { data, error, count } = await query;
  if (error) return teamFailure(error);

  const { data: all } = await supabase.from("people").select("department, source, status").eq("org_id", orgId).limit(20000);
  const rows = (all ?? []) as { department: string; source: string; status: string }[];
  const tally = (key: "department" | "source" | "status") => {
    const out: Record<string, number> = {};
    for (const r of rows) if (r[key]) out[r[key]] = (out[r[key]] ?? 0) + 1;
    return out;
  };
  return Response.json({ people: data ?? [], total: count ?? 0, counts: { all: rows.length, departments: tally("department"), sources: tally("source"), statuses: tally("status") } }, { headers: noStore });
}

/** Add one person by hand. */
export async function POST(req: Request) {
  const a = await teamAdmin(req, z.object({ person: z.record(z.string(), z.unknown()) }));
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const parsed = normalizePerson(a.ctx.data.person as z.input<typeof PersonInput>);
  if (!parsed.ok) return Response.json({ error: "bad_request", message: parsed.message, field: parsed.field }, { status: 400, headers: noStore });
  const { external_id, ...rest } = parsed.person;
  const { data, error } = await supabase.from("people").insert({ ...rest, external_id: external_id || null, org_id: orgId, source: "manual" }).select("id").single();
  if (error) return teamFailure(error);
  return Response.json({ id: data.id }, { status: 201, headers: noStore });
}
