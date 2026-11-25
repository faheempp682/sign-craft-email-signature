/**
 * Every compatibility claim the marketing site may make, in one place.
 *
 * The product has NOT yet been verified in real Gmail and Outlook (docs/STATUS.md, docs/client-testing.md). Until it
 * is, each claim has `verified: false`, and pages must use `claimText(id)`, which returns the modest "design intent"
 * wording. Flip a switch to true ONLY after the matching checklist has passed with real accounts and clients.
 *
 * `forbidden` are patterns for the strong wording. claims.test.ts scans all page copy and fails if any pattern of a
 * claim whose switch is off appears. Write page copy with `claimText()`, or avoid the topic.
 */

export type ClaimId = "outlookRendering" | "gmailRendering" | "gmailPush" | "mobileClients";

export type Claim = {
  /** true only after real-client testing has passed. */
  verified: boolean;
  /** What we may say once verified. */
  strong: string;
  /** What we may say now: design intent, not a result. */
  intent: string;
  /** Strong wording that must not appear in page copy while `verified` is false. */
  forbidden: RegExp[];
};

export const CLAIMS: Record<ClaimId, Claim> = {
  outlookRendering: {
    verified: false,
    strong: "Signatures that never break in Outlook.",
    intent: "Built to Outlook-safe rules: tables, inline CSS and safe fonts.",
    forbidden: [
      /never\s+(break|breaks|looks?\s+broken)/i,
      /(works?|renders?|looks?|displays?)\s+(perfectly|flawlessly|correctly|identically)\s+(in|on|across)\s+(all\s+)?(outlook|email\s+clients)/i,
      /guaranteed\s+(to\s+)?(work|render)/i,
      /(tested|verified|proven)\s+(in|on|with)\s+(real\s+|every\s+|all\s+)?(outlook|email\s+clients)/i,
      /outlook[- ]proof/i,
    ],
  },
  gmailRendering: {
    verified: false,
    strong: "Looks right in Gmail.",
    intent: "Uses plain tables and inline styles, which Gmail is known to accept.",
    forbidden: [
      /(works?|renders?|looks?|displays?)\s+(perfectly|flawlessly|correctly|identically)\s+(in|on)\s+gmail/i,
      /(tested|verified|proven)\s+(in|on|with)\s+(real\s+)?gmail/i,
      /gmail[- ]proof/i,
    ],
  },
  gmailPush: {
    verified: false,
    strong: "Send your signature to Gmail in one click.",
    intent: "Optional Gmail push for Google Workspace is built and still being verified with real accounts.",
    forbidden: [
      /(one|1)[- ]click\s+(install|push|setup|deploy)/i,
      /(installs?|pushes|sends?|deploys?)\s+(it\s+|your\s+signatures?\s+|the\s+signatures?\s+)?(straight\s+|directly\s+)?(in)?to\s+gmail/i,
      /gmail\s+(push|integration|sync)\s+(works|is\s+live|is\s+available|is\s+ready)/i,
      /sync(s|ed)?\s+(with|to)\s+gmail/i,
    ],
  },
  mobileClients: {
    verified: false,
    strong: "Looks right on every phone and tablet mail app.",
    intent: "Designed to stay narrow and readable on small screens; not yet checked in every mail app.",
    forbidden: [
      /(every|all)\s+(phone|mobile|tablet|device)s?(\s+and\s+tablets?)?\s+(mail\s+)?(app|client)s?/i,
      /(works?|looks?|renders?)\s+(perfectly|flawlessly)\s+on\s+(mobile|phones?)/i,
    ],
  },
};

/** The wording a page may use for a claim right now. */
export function claimText(id: ClaimId, claims: Record<ClaimId, Claim> = CLAIMS): string {
  const c = claims[id];
  return c.verified ? c.strong : c.intent;
}

/** Patterns of unverified claims that match `copy`. Empty means the copy is honest. */
export function unverifiedClaimHits(copy: string, claims: Record<ClaimId, Claim> = CLAIMS): { id: ClaimId; match: string }[] {
  const hits: { id: ClaimId; match: string }[] = [];
  for (const id of Object.keys(claims) as ClaimId[]) {
    if (claims[id].verified) continue;
    for (const re of claims[id].forbidden) {
      const m = re.exec(copy);
      if (m) hits.push({ id, match: m[0] });
    }
  }
  return hits;
}
