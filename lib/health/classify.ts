import { isEmptySignature, signatureHash, textFingerprint } from "./fingerprint";

/**
 * Decides what state one person's live signature is in. Pure: no network, no database.
 *
 * Inputs
 *   live          the HTML Gmail holds now for their primary address
 *   expectedFp    text fingerprint of what SignCraft deployed, or null when it cannot be rebuilt exactly (the template or the
 *                 person's directory data changed since the deployment, so a re-render no longer equals what was sent)
 *   baseline      the live signature as Gmail stored it at the first check after the deployment (null before that)
 *
 * Order of decision (what is certain, what is a heuristic):
 *   1. empty                                                   -> removed (certain, given a successful read)
 *   2. expected text known:  live text == expected text        -> ok. If the HTML also differs from the baseline it is counted as
 *                                                                "reformatted" (HEURISTIC: assumes Gmail only changed markup)
 *                            live text != expected text        -> edited (the words differ from what was approved: reliable)
 *   3. expected text unknown, no baseline yet                  -> ok, baseline recorded, NOT verified (nothing to compare to)
 *   4. expected text unknown, baseline exists: same HTML       -> ok (certain: unchanged since the baseline)
 *                                              same text       -> ok, reformatted (HEURISTIC)
 *                                              different text  -> edited
 * The baseline is "verified" only when its text was seen equal to the approved text. A baseline taken from an already edited
 * signature is stored but not verified, and it never hides the edit while the expected text is known (step 2 ignores it).
 */

export type Baseline = { hash: string | null; fp: string | null; verified: boolean };
export type Status = "ok" | "edited" | "removed";

export type Verdict = {
  status: Status;
  baseline: Baseline;
  reformatted: boolean;
  liveHash: string;
  liveFp: string;
  detail: string;
};

export function classifyLive(o: { live: string; expectedFp: string | null; baseline: Baseline }): Verdict {
  const liveHash = signatureHash(o.live);
  const liveFp = textFingerprint(o.live);
  const b = o.baseline;
  const hasBase = b.hash !== null;
  const done = (status: Status, baseline: Baseline, reformatted: boolean, detail: string): Verdict => ({ status, baseline, reformatted, liveHash, liveFp, detail });

  if (isEmptySignature(o.live)) return done("removed", b, false, "The signature in Gmail is empty.");

  if (o.expectedFp !== null) {
    if (liveFp === o.expectedFp) {
      const reformatted = hasBase && liveHash !== b.hash;
      const keep = hasBase && b.verified;
      return done("ok", keep ? b : { hash: liveHash, fp: liveFp, verified: true }, reformatted, reformatted ? "The text is the approved text; Gmail stores the markup differently from the first check (treated as reformatting)." : "");
    }
    return done("edited", hasBase ? b : { hash: liveHash, fp: liveFp, verified: false }, false, "The words in the signature differ from the approved signature.");
  }

  if (!hasBase) return done("ok", { hash: liveHash, fp: liveFp, verified: false }, false, "First check: the approved text could not be rebuilt, so the baseline was recorded without comparing it.");
  if (liveHash === b.hash) return done("ok", b, false, "");
  if (liveFp === b.fp) return done("ok", b, true, "The text equals the baseline; the markup differs (treated as reformatting).");
  return done("edited", b, false, "The words in the signature differ from the baseline recorded after the deployment.");
}
