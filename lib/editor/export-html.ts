import type { SignatureDoc } from "@/lib/schema/document";

/** True when any banner asks for click tracking. */
export const hasTrackedBanner = (doc: SignatureDoc): boolean => doc.blocks.some((b) => b.type === "banner" && b.track === true);

export type ExportHtml = { ok: true; html: string } | { ok: false; message: string };

/**
 * The HTML to copy or download. Normally that is just what the browser rendered. A banner with click tracking needs a
 * signed link that only the server can make (the signing secret never leaves it), and the server only signs links for
 * signatures the person has saved, so a tracked banner on an unsaved signature is explained rather than silently
 * exported without tracking.
 */
export async function exportHtml(doc: SignatureDoc, localHtml: string, signatureId: string | null): Promise<ExportHtml> {
  if (!hasTrackedBanner(doc)) return { ok: true, html: localHtml };
  if (!signatureId) return { ok: false, message: "This signature tracks banner clicks. Save it first, so the tracked links can be created, then copy it." };
  try {
    const res = await fetch("/api/campaigns/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc, signature_id: signatureId }) });
    const data = (await res.json().catch(() => null)) as { html?: string; tracked?: boolean; message?: string } | null;
    if (!res.ok || !data?.html) return { ok: false, message: data?.message ?? "Could not create the tracked links. Please try again." };
    if (!data.tracked) return { ok: false, message: "Click tracking is not set up on the server yet (an admin needs to set CAMPAIGN_TOKEN_SECRET), so the banner link would not be tracked." };
    return { ok: true, html: data.html };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}
