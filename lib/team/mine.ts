import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonData } from "./render";
import { validateSpec, type TemplateSpec } from "./template";

export type VersionRow = {
  id: string;
  version_no: number;
  status: "draft" | "pending" | "approved" | "rejected";
  values_json: Record<string, string>;
  created_at: string;
  reviewed_at: string | null;
  review_note: string;
};

export type Mine =
  | { state: "no_person" }
  | { state: "no_template"; orgId: string; person: PersonData & { id: string } }
  | {
      state: "ok";
      orgId: string;
      person: PersonData & { id: string };
      template: { id: string; name: string; spec: TemplateSpec };
      requireApproval: boolean;
      /** The newest approved version (what gets deployed), the version waiting for review, and recent history. */
      approved: VersionRow | null;
      pending: VersionRow | null;
      history: VersionRow[];
    };

const PERSON = "id, org_id, email, full_name, first_name, last_name, title, department, phone, mobile, location, custom";
const VERSION = "id, version_no, status, values_json, created_at, reviewed_at, review_note";

/**
 * What the signed-in employee sees. Everything is read through their own session, so row-level security decides:
 * their own person row, the single template that applies to them, their own versions.
 */
export async function loadMine(supabase: SupabaseClient, userId: string): Promise<Mine> {
  const { data: memberships } = await supabase.from("memberships").select("org_id").eq("user_id", userId);
  for (const m of (memberships ?? []) as { org_id: string }[]) await supabase.rpc("claim_my_person", { p_org: m.org_id });

  const { data: people } = await supabase.from("people").select(PERSON).eq("user_id", userId).eq("status", "active").order("created_at").limit(1);
  const row = (people ?? [])[0] as (PersonData & { id: string; org_id: string }) | undefined;
  if (!row) return { state: "no_person" };
  const { org_id: orgId, ...person } = row;

  const { data: templateId } = await supabase.rpc("template_for_person", { p_person: person.id });
  if (typeof templateId !== "string") return { state: "no_template", orgId, person };
  const { data: t } = await supabase.from("brand_templates").select("id, name, doc_json, lock_json, field_map").eq("id", templateId).maybeSingle();
  const spec = t ? validateSpec({ doc: t.doc_json, lock: t.lock_json, field_map: t.field_map }) : null;
  if (!t || !spec?.ok) return { state: "no_template", orgId, person };

  const [{ data: settings }, { data: versions }] = await Promise.all([
    supabase.from("org_settings").select("require_approval").eq("org_id", orgId).maybeSingle(),
    supabase.from("signature_versions").select(VERSION).eq("person_id", person.id).order("version_no", { ascending: false }).limit(10),
  ]);
  const list = (versions ?? []) as VersionRow[];
  return {
    state: "ok",
    orgId,
    person,
    template: { id: t.id, name: t.name, spec: spec.spec },
    requireApproval: settings?.require_approval === true,
    approved: list.find((v) => v.status === "approved") ?? null,
    pending: list.find((v) => v.status === "pending") ?? null,
    history: list,
  };
}
