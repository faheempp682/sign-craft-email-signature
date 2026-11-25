/**
 * Designer-polish statuses and the allowed transitions. The database enforces the same table
 * (trigger polish_guard in supabase/migrations/0008_designer_polish.sql); a test keeps the two in step.
 */
export const POLISH_STATUSES = ["requested", "in_progress", "delivered", "accepted", "declined", "cancelled"] as const;
export type PolishStatus = (typeof POLISH_STATUSES)[number];
export const isPolishStatus = (v: unknown): v is PolishStatus => typeof v === "string" && (POLISH_STATUSES as readonly string[]).includes(v);

export const TRANSITIONS: Record<PolishStatus, readonly PolishStatus[]> = {
  requested: ["in_progress", "cancelled"],
  in_progress: ["delivered", "requested", "cancelled"],
  delivered: ["accepted", "requested", "declined", "cancelled"],
  accepted: [],
  declined: [],
  cancelled: [],
};

export const canTransition = (from: PolishStatus, to: PolishStatus) => TRANSITIONS[from].includes(to);
export const isOpen = (s: PolishStatus) => TRANSITIONS[s].length > 0;

export const STATUS_LABEL: Record<PolishStatus, string> = {
  requested: "Waiting for a designer",
  in_progress: "Designer working",
  delivered: "Ready to review",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const ORIGIN_LABEL = { ai: "AI draft", manual: "Hand made" } as const;
export type PolishOrigin = keyof typeof ORIGIN_LABEL;
