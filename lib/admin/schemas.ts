import { z } from "zod";
import { AI_FEATURES, FEATURES, ROLES, type Feature } from "@/lib/authz/roles";

const feature = z.enum(Object.keys(FEATURES) as [Feature, ...Feature[]], { error: "Unknown feature." });
const role = z.enum(ROLES, { error: "Unknown role." });
const limit = z
  .number({ error: "Enter a whole number, or leave blank for no limit." })
  .int("Enter a whole number.")
  .min(0, "Limits cannot be negative.")
  .max(1_000_000, "That limit is too high.")
  .nullable();
const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

/** Change a flag's default or its minimum role. At least one of the two. */
export const FlagPatch = z
  .object({ feature, default_enabled: z.boolean().optional(), min_role: role.optional() })
  .refine((v) => v.default_enabled !== undefined || v.min_role !== undefined, { message: "Nothing to change." });

/** Turn a feature on or off for one user (by email) or one organization (by id). */
export const OverrideSet = z.discriminatedUnion("subject_type", [
  z.object({ subject_type: z.literal("user"), email, feature, enabled: z.boolean() }),
  z.object({ subject_type: z.literal("org"), org_id: z.string().uuid("Pick an organization."), feature, enabled: z.boolean() }),
]);

/** Remove an override, so the feature falls back to the role default. */
export const OverrideRemove = z.object({ subject_type: z.enum(["user", "org"]), subject_id: z.string().uuid(), feature });

export const LimitSet = z.object({ role, feature: z.enum(AI_FEATURES, { error: "Limits apply to AI features only." }), per_minute: limit, per_day: limit });

export const MemberSet = z.object({ email, role });
