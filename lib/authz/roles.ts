/** Roles, lowest to highest. The same order as the `app_role` enum in the database. */
export const ROLES = ["member", "designer", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/** True when `role` is at least `min` (admin passes everything, designer passes designer and member). */
export const atLeast = (role: Role, min: Role): boolean => ROLES.indexOf(role) >= ROLES.indexOf(min);

/**
 * Every feature flag the app knows about, with the wording used in messages.
 * The defaults themselves live in the database (`feature_flags`) so admins can change them; a test keeps this list
 * and the seeded rows in step.
 */
export const FEATURES = {
  ai_autofill: "AI autofill",
  ai_design: "AI design",
  ai_vision: "Screenshot to signature",
  gmail_push: "Gmail one-click install",
  animated_gif: "Animated GIF signatures",
  custom_html: "Custom HTML",
  designer_polish: "Designer polish",
  analytics: "Analytics",
  team_deploy: "Team deployment",
} as const;
export type Feature = keyof typeof FEATURES;
export const isFeature = (v: unknown): v is Feature => typeof v === "string" && Object.hasOwn(FEATURES, v);

/** Features that call a paid model. These are the ones with per-minute and per-day limits. */
export const AI_FEATURES = ["ai_autofill", "ai_design", "ai_vision"] as const satisfies readonly Feature[];
export type AiFeature = (typeof AI_FEATURES)[number];
export const isAiFeature = (v: unknown): v is AiFeature => typeof v === "string" && (AI_FEATURES as readonly string[]).includes(v);
