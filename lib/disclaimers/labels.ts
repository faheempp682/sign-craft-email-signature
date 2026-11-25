/** Types and wording shared by the editor helpers and the admin screen (no server code, safe in the browser). */

export type Disclaimer = {
  id: string;
  org_id: string | null;
  title: string;
  category: "confidentiality" | "data_protection" | "financial" | "medical" | "legal" | "other";
  jurisdiction: string;
  body: string;
  needs_review: boolean;
};

export const CATEGORY_LABEL: Record<Disclaimer["category"], string> = {
  confidentiality: "Confidentiality",
  data_protection: "Data protection",
  financial: "Financial",
  medical: "Medical",
  legal: "Legal",
  other: "Other",
};

export const REVIEW_NOTE = "These are starting points only, not legal advice. Have a lawyer review the wording for your organization and jurisdiction before use.";
