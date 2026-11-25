import { renderToEmailHtml } from "@/lib/renderer/email-html";
import type { SignatureDoc } from "@/lib/schema/document";
import { fingerprint } from "./crypto";
import { GoogleError } from "./errors";
import { MAX_SIGNATURE_CHARS, getSendAs, setSignature } from "./gmail";

/**
 * Putting a signature into Gmail is a two-step handshake, so that nothing is ever replaced without approval:
 *
 *   1. PREVIEW  The server renders the new signature itself (never trusting HTML from the browser), reads the signature
 *               Gmail currently holds for the chosen address, and returns both with a fingerprint of each.
 *   2. PUSH     The person confirms. The request must carry `confirm: true` AND both fingerprints. The server repeats
 *               the work and refuses unless the new HTML and the existing signature are still exactly what the person saw.
 *
 * So the text on the screen at the moment of clicking is, byte for byte, what replaces what was there.
 */

export type Preview = {
  address: { email: string; displayName: string; isPrimary: boolean };
  newHtml: string;
  newHash: string;
  newLength: number;
  limit: number;
  tooLong: boolean;
  current: { html: string; hash: string; hasSignature: boolean };
};

type Fetch = typeof fetch;

export async function buildPreview(accessToken: string, doc: SignatureDoc, email: string, fetchFn: Fetch = fetch): Promise<Preview> {
  const target = await getSendAs(accessToken, email, fetchFn);
  if (!target.canEdit) throw new GoogleError("address_not_editable", `${target.email} is an alias that Gmail has not verified, so its signature cannot be changed yet.`, 422);
  const newHtml = renderToEmailHtml(doc);
  return {
    address: { email: target.email, displayName: target.displayName, isPrimary: target.isPrimary },
    newHtml,
    newHash: fingerprint(newHtml),
    newLength: newHtml.length,
    limit: MAX_SIGNATURE_CHARS,
    tooLong: newHtml.length > MAX_SIGNATURE_CHARS,
    current: { html: target.signature, hash: fingerprint(target.signature), hasSignature: target.signature.trim().length > 0 },
  };
}

export type Approval = { confirm: boolean; newHash: string; currentHash: string };

export type PushResult = { email: string; previousSignature: string; newHash: string };

/** Replaces the signature, but only if the person approved exactly what is about to happen. */
export async function pushApproved(accessToken: string, doc: SignatureDoc, email: string, approval: Approval, fetchFn: Fetch = fetch): Promise<PushResult> {
  if (approval.confirm !== true) throw new GoogleError("not_confirmed", "Confirm the replacement first. Nothing was changed.", 400);

  const p = await buildPreview(accessToken, doc, email, fetchFn);
  if (p.tooLong) throw new GoogleError("too_long", `This signature is ${p.newLength.toLocaleString("en-US")} characters, over Gmail's ${p.limit.toLocaleString("en-US")} limit. Shorten the disclaimer or choose a simpler template. Nothing was changed.`, 422);
  if (approval.newHash !== p.newHash) throw new GoogleError("preview_stale", "The new signature is not the one you previewed. Review the preview again. Nothing was changed.", 409);
  if (approval.currentHash !== p.current.hash) throw new GoogleError("changed", `The signature on ${p.address.email} changed after you looked at it. Review it again. Nothing was changed.`, 409);

  await setSignature(accessToken, p.address.email, p.newHtml, fetchFn);
  return { email: p.address.email, previousSignature: p.current.html, newHash: p.newHash };
}
