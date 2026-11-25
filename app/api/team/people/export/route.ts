import { toCsv } from "@/lib/team/csv";
import { teamAdmin, teamFailure } from "@/lib/team/route";

export const runtime = "nodejs";

const BASE = ["email", "full_name", "first_name", "last_name", "title", "department", "phone", "mobile", "location", "status", "source", "external_id"] as const;

/** The directory as a CSV file. Cells that could run as spreadsheet formulas are prefixed with an apostrophe. */
export async function GET(req: Request) {
  const a = await teamAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("people").select([...BASE, "custom"].join(", ")).eq("org_id", orgId).order("email").limit(20000);
  if (error) return teamFailure(error);
  const people = (data ?? []) as unknown as (Record<string, string> & { custom: Record<string, string> })[];
  const customKeys = [...new Set(people.flatMap((p) => Object.keys(p.custom ?? {})))].sort().slice(0, 10);
  const csv = toCsv([...BASE, ...customKeys], people.map((p) => [...BASE.map((c) => p[c] ?? ""), ...customKeys.map((k) => p.custom?.[k] ?? "")]));
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="people.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
