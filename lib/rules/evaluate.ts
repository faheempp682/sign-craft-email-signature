/**
 * Signature rules: which brand template applies in which situation. Pure functions, no I/O.
 *
 * A rule matches a CONTEXT { department, kind, audience } when every dimension it constrains matches:
 *   message kind  new | reply | forward | any
 *   audience      internal | external | any   (who the message goes to)
 *   departments   a list (empty = anyone); compared case-insensitively, a person with no department never matches a list
 * Among matching rules the winner is chosen deterministically:
 *   1. higher priority number first
 *   2. more specific first (number of constrained dimensions: kind, audience, departments)
 *   3. older first (created_at), then id
 * This order does not depend on the context, so it can also be written out as an ordered list of Exchange rules.
 */

export const MESSAGE_KINDS = ["any", "new", "reply", "forward"] as const;
export const AUDIENCES = ["any", "internal", "external"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type Audience = (typeof AUDIENCES)[number];

export const MIN_PRIORITY = 0;
export const MAX_PRIORITY = 1000;
/** Implicit rules made from brand templates sit below every explicit rule. */
export const TEMPLATE_DEPARTMENT_PRIORITY = -1000;
export const DEFAULT_PRIORITY = -2000;

export type Rule = {
  id: string;
  name: string;
  message_kind: MessageKind;
  audience: Audience;
  departments: string[];
  priority: number;
  template_id: string;
  is_active: boolean;
  created_at: string;
  /** true for rules made from brand templates (not stored, not editable here) */
  implicit?: boolean;
};

export type Context = { department: string; kind: Exclude<MessageKind, "any">; audience: Exclude<Audience, "any"> };

export const normDept = (d: string) => d.trim().toLowerCase();

export function specificity(r: Pick<Rule, "message_kind" | "audience" | "departments">): number {
  return (r.message_kind !== "any" ? 1 : 0) + (r.audience !== "any" ? 1 : 0) + (r.departments.length > 0 ? 1 : 0);
}

/** Sort order: first element wins. Does not depend on the context. */
export function compareRules(a: Rule, b: Rule): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const s = specificity(b) - specificity(a);
  if (s) return s;
  const t = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (t) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function matches(rule: Rule, ctx: Context): boolean {
  if (!rule.is_active) return false;
  if (rule.message_kind !== "any" && rule.message_kind !== ctx.kind) return false;
  if (rule.audience !== "any" && rule.audience !== ctx.audience) return false;
  if (rule.departments.length) {
    const d = normDept(ctx.department);
    if (!d || !rule.departments.some((x) => normDept(x) === d)) return false;
  }
  return true;
}

export const sortRules = (rules: Rule[]) => [...rules].sort(compareRules);

export type Evaluation = { winner: Rule | null; matched: Rule[] };

/** All matching rules in order; the first is the winner. A null winner means no rule (and no default) applies. */
export function evaluate(ctx: Context, rules: Rule[]): Evaluation {
  const matched = sortRules(rules).filter((r) => matches(r, ctx));
  return { winner: matched[0] ?? null, matched };
}

export type TemplateLite = { id: string; name: string; departments: string[]; is_active: boolean; created_at: string };

/**
 * The explicit rules plus the implicit ones that come from the brand templates (same ordering the team directory
 * uses for template_for_person): a template for departments applies to those departments, and the oldest template
 * without departments is the default. Implicit rules always rank below explicit ones.
 */
export function effectiveRules(rules: Rule[], templates: TemplateLite[]): Rule[] {
  const active = templates.filter((t) => t.is_active);
  const implicit: Rule[] = [];
  for (const t of active) {
    if (t.departments.length)
      implicit.push({ id: `template-department:${t.id}`, name: `${t.name} (brand template departments)`, message_kind: "any", audience: "any", departments: t.departments, priority: TEMPLATE_DEPARTMENT_PRIORITY, template_id: t.id, is_active: true, created_at: t.created_at, implicit: true });
  }
  const def = active.filter((t) => !t.departments.length).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : 1))[0];
  if (def) implicit.push({ id: `default:${def.id}`, name: `${def.name} (default)`, message_kind: "any", audience: "any", departments: [], priority: DEFAULT_PRIORITY, template_id: def.id, is_active: true, created_at: def.created_at, implicit: true });
  return [...rules.filter((r) => !r.implicit), ...implicit];
}

/* ------------------------------------------------------------------ what each target can honour */

export type Support = "enforced" | "unverified" | "unsupported";
export type TargetName = "gmail" | "exchange";

/**
 * How well a target can carry each dimension of a rule. Never claim more than this.
 * Gmail keeps ONE signature per address whatever the message is, so only the person's department can pick it.
 * Exchange: the sender/recipient scope and the sender's department (AD attribute) conditions are documented; new vs
 * reply relies on the In-Reply-To header and is not verified; there is no reliable condition for "forward".
 */
export function dimensionSupport(target: TargetName): { kind: Record<MessageKind, Support>; audience: Record<Audience, Support>; department: Support } {
  if (target === "gmail") {
    return { kind: { any: "enforced", new: "unsupported", reply: "unsupported", forward: "unsupported" }, audience: { any: "enforced", internal: "unsupported", external: "unsupported" }, department: "enforced" };
  }
  return {
    kind: { any: "enforced", new: "unverified", reply: "unverified", forward: "unsupported" },
    audience: { any: "enforced", internal: "enforced", external: "enforced" },
    department: "enforced",
  };
}

export type RuleSupport = { level: Support; reasons: string[] };

/** The weakest support among the dimensions the rule uses, with the reason for each limit. */
export function ruleSupport(rule: Pick<Rule, "message_kind" | "audience" | "departments">, target: TargetName): RuleSupport {
  const s = dimensionSupport(target);
  const parts: [Support, string][] = [
    [s.kind[rule.message_kind], `message kind "${rule.message_kind}"`],
    [s.audience[rule.audience], `audience "${rule.audience}"`],
  ];
  if (rule.departments.length) parts.push([s.department, "department"]);
  const order: Support[] = ["enforced", "unverified", "unsupported"];
  let level: Support = "enforced";
  const reasons: string[] = [];
  for (const [l, label] of parts) {
    if (l !== "enforced") reasons.push(`${label}: ${l === "unsupported" ? "not supported" : "unverified"}`);
    if (order.indexOf(l) > order.indexOf(level)) level = l;
  }
  return { level, reasons };
}

/** Rules a target can carry (unverified ones included, labelled). */
export const honoured = (rules: Rule[], target: TargetName) => rules.filter((r) => ruleSupport(r, target).level !== "unsupported");

/* ----------------------------------------------------------------------------- words */

const KIND_WORDS: Record<MessageKind, string> = { any: "any message", new: "new messages", reply: "replies", forward: "forwarded messages" };
const AUDIENCE_WORDS: Record<Audience, string> = { any: "", internal: " to people inside the organization", external: " to people outside the organization" };

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** One plain-language sentence for the editor. */
export function describeRule(rule: Pick<Rule, "message_kind" | "audience" | "departments" | "priority" | "is_active">, templateName: string): string {
  const who = rule.departments.length ? ` from people in ${list(rule.departments)}` : "";
  const base = `Use "${templateName}" for ${KIND_WORDS[rule.message_kind]}${AUDIENCE_WORDS[rule.audience]}${who}.`;
  return `${base} Priority ${rule.priority}.${rule.is_active ? "" : " (switched off)"}`;
}
