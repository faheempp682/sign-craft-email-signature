import { z } from "zod";
import { AUDIENCES, MAX_PRIORITY, MESSAGE_KINDS, MIN_PRIORITY } from "./evaluate";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Pick a template.");

/** Department names: one line, no comma (Exchange attribute values are comma separated), no control characters. */
const DEPT = z.string().trim().min(1).max(80).regex(/^[^,\u0000-\u001f\u007f]+$/, "Department names cannot contain commas or line breaks.");

const departments = z
  .array(DEPT)
  .max(20)
  .transform((a) => [...new Map(a.map((d) => [d.toLowerCase(), d])).values()]);

export const RuleInput = z.object({
  name: z.string().trim().min(1, "Give the rule a name.").max(80),
  message_kind: z.enum(MESSAGE_KINDS).default("any"),
  audience: z.enum(AUDIENCES).default("any"),
  departments: departments.default([]),
  priority: z.number().int().min(MIN_PRIORITY).max(MAX_PRIORITY).default(100),
  template_id: UUID,
  is_active: z.boolean().default(true),
});

/** A change to a rule: only the fields sent are touched (no defaults are applied). */
export const RulePatch = z.object({
  name: z.string().trim().min(1, "Give the rule a name.").max(80),
  message_kind: z.enum(MESSAGE_KINDS),
  audience: z.enum(AUDIENCES),
  departments,
  priority: z.number().int().min(MIN_PRIORITY).max(MAX_PRIORITY),
  template_id: UUID,
  is_active: z.boolean(),
}).partial();
export type RuleInputT = z.infer<typeof RuleInput>;

export const RuleTest = z.object({
  person_id: UUID,
  kind: z.enum(["new", "reply", "forward"]),
  audience: z.enum(["internal", "external"]),
});
