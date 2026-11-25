import { createHash } from "node:crypto";

export type Variant = { id: string; weight: number };

/**
 * Deterministic A/B choice: the same signature always gets the same variant of a campaign, with no cookie and no
 * stored assignment. sha256(campaign + signature) maps to a point in [0,1) that is looked up in the cumulative weights.
 * Variants are ordered by id first, so the order rows come back from the database never changes the outcome.
 * Changing weights or adding variants can move a signature to another variant (documented).
 */
export function pickVariant<T extends Variant>(variants: readonly T[], campaignId: string, signatureId: string): T | null {
  const live = variants.filter((v) => v.weight > 0).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const total = live.reduce((n, v) => n + v.weight, 0);
  if (!live.length || total <= 0) return null;
  const h = createHash("sha256").update(`${campaignId}|${signatureId}`).digest();
  const point = (h.readUIntBE(0, 6) / 2 ** 48) * total;
  let acc = 0;
  for (const v of live) {
    acc += v.weight;
    if (point < acc) return v;
  }
  return live[live.length - 1];
}

export type Schedule = { status: string; starts_at: string | null; ends_at: string | null };

/** Active, started and not yet ended. Paused, draft and ended campaigns never run, whatever their dates. */
export function isRunning(c: Schedule, now: Date): boolean {
  if (c.status !== "active") return false;
  const t = now.getTime();
  if (c.starts_at && Date.parse(c.starts_at) > t) return false;
  if (c.ends_at && Date.parse(c.ends_at) <= t) return false;
  return true;
}
