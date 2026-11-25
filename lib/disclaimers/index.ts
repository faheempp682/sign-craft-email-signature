import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/schema/document";

/** Helpers for the editor to offer and insert legal disclaimer templates. */

import type { Disclaimer } from "./labels";

export { CATEGORY_LABEL, REVIEW_NOTE, type Disclaimer } from "./labels";

const COLUMNS = "id, org_id, title, category, jurisdiction, body, needs_review";

/** Global templates and the person's organization's own, global first. Row-level security decides what is visible. */
export async function listDisclaimers(supabase: SupabaseClient, filter: { category?: Disclaimer["category"]; jurisdiction?: string } = {}): Promise<Disclaimer[]> {
  let q = supabase.from("legal_disclaimers").select(COLUMNS).order("title");
  if (filter.category) q = q.eq("category", filter.category);
  if (filter.jurisdiction) q = q.eq("jurisdiction", filter.jurisdiction);
  const { data, error } = await q.limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Disclaimer[];
  return [...rows.filter((r) => r.org_id === null), ...rows.filter((r) => r.org_id !== null)];
}

/** The `disclaimer` block for a template. The text is copied, so later edits to the template do not change signatures already made. */
export function toDisclaimerBlock(d: Pick<Disclaimer, "body">): Extract<Block, { type: "disclaimer" }> {
  return { type: "disclaimer", text: d.body.slice(0, 1500) };
}

/** Adds the disclaimer to the end of the block list, or replaces an existing disclaimer block (a signature has one). */
export function insertDisclaimer(blocks: Block[], d: Pick<Disclaimer, "body">): Block[] {
  const block = toDisclaimerBlock(d);
  const at = blocks.findIndex((b) => b.type === "disclaimer");
  if (at < 0) return [...blocks, block];
  return blocks.map((b, i) => (i === at ? block : b));
}
