import { z } from "zod";
import { CustomFields } from "@/lib/team/people";
import { badId, noStore, notFound, teamAdmin, teamFailure, UUID_RE } from "@/lib/team/route";

export const runtime = "nodejs";

const t = (max: number) => z.string().trim().max(max);
const Patch = z.object({
  person: z
    .object({
      email: z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address."),
      full_name: t(120).min(1, "A name is required."),
      first_name: t(60),
      last_name: t(60),
      title: t(100),
      department: t(80),
      phone: t(40),
      mobile: t(40),
      location: t(120),
      status: z.enum(["active", "inactive"]),
      external_id: t(200),
      custom: CustomFields,
    })
    .partial()
    .strict(),
});

/** Change one person. Only fields that are sent change; the organization can never be changed. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  const a = await teamAdmin(req, Patch);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const patch = { ...a.ctx.data.person } as Record<string, unknown>;
  if (Object.keys(patch).length === 0) return Response.json({ error: "bad_request", message: "Nothing to change." }, { status: 400, headers: noStore });
  if ("external_id" in patch) patch.external_id = patch.external_id || null;
  const { data, error } = await supabase.from("people").update(patch).eq("id", id).eq("org_id", orgId).select("id").maybeSingle();
  if (error) return teamFailure(error);
  if (!data) return notFound("person");
  return Response.json({ id: data.id }, { headers: noStore });
}

/** Remove a person (their signature history goes with them; mark them inactive instead to keep it). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();
  const a = await teamAdmin(req, null);
  if (!a.ok) return a.response;
  const { supabase, orgId } = a.ctx.ctx;
  const { data, error } = await supabase.from("people").delete().eq("id", id).eq("org_id", orgId).select("id");
  if (error) return teamFailure(error);
  if (!data?.length) return notFound("person");
  return Response.json({ ok: true }, { headers: noStore });
}
