import { describe, expect, it } from "vitest";
import { compareRules, describeRule, effectiveRules, evaluate, honoured, matches, ruleSupport, specificity, type Context, type Rule, type TemplateLite } from "./evaluate";
import { RuleInput } from "./schema";

let n = 0;
const rule = (o: Partial<Rule> = {}): Rule => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  name: `r${n}`,
  message_kind: "any",
  audience: "any",
  departments: [],
  priority: 100,
  template_id: `tpl-${n}`,
  is_active: true,
  created_at: `2026-01-${String(10 + (n % 15)).padStart(2, "0")}T00:00:00Z`,
  ...o,
});
const ctx = (o: Partial<Context> = {}): Context => ({ department: "Sales", kind: "new", audience: "external", ...o });

describe("matches", () => {
  it("any/any/no departments matches everything", () => {
    expect(matches(rule(), ctx())).toBe(true);
  });
  it("kind must be equal unless any", () => {
    expect(matches(rule({ message_kind: "reply" }), ctx({ kind: "new" }))).toBe(false);
    expect(matches(rule({ message_kind: "reply" }), ctx({ kind: "reply" }))).toBe(true);
    expect(matches(rule({ message_kind: "forward" }), ctx({ kind: "forward" }))).toBe(true);
  });
  it("audience must be equal unless any", () => {
    expect(matches(rule({ audience: "internal" }), ctx({ audience: "external" }))).toBe(false);
    expect(matches(rule({ audience: "internal" }), ctx({ audience: "internal" }))).toBe(true);
  });
  it("departments: case-insensitive, trimmed, and a person without a department never matches a list", () => {
    expect(matches(rule({ departments: ["sales", "Ops"] }), ctx({ department: "  SALES " }))).toBe(true);
    expect(matches(rule({ departments: ["Ops"] }), ctx({ department: "Sales" }))).toBe(false);
    expect(matches(rule({ departments: ["Ops"] }), ctx({ department: "" }))).toBe(false);
    expect(matches(rule({ departments: ["Sales"] }), ctx({ department: "Sales Europe" }))).toBe(false);
  });
  it("an inactive rule never matches", () => {
    expect(matches(rule({ is_active: false }), ctx())).toBe(false);
  });
});

describe("evaluate: winner and tie-breaks", () => {
  it("returns no winner when nothing matches", () => {
    expect(evaluate(ctx(), [rule({ departments: ["Ops"] })]).winner).toBeNull();
    expect(evaluate(ctx(), []).winner).toBeNull();
  });
  it("higher priority wins even over a more specific rule", () => {
    const high = rule({ priority: 200 });
    const specific = rule({ priority: 100, departments: ["Sales"], audience: "external" });
    expect(evaluate(ctx(), [specific, high]).winner?.id).toBe(high.id);
  });
  it("equal priority: the more specific rule wins", () => {
    const general = rule();
    const dept = rule({ departments: ["Sales"] });
    const both = rule({ departments: ["Sales"], audience: "external" });
    expect(evaluate(ctx(), [general, dept, both]).winner?.id).toBe(both.id);
    expect(evaluate(ctx(), [general, dept]).winner?.id).toBe(dept.id);
    expect(specificity(both)).toBe(2);
  });
  it("equal priority and specificity: older wins, then the smaller id", () => {
    const older = rule({ created_at: "2025-01-01T00:00:00Z" });
    const newer = rule({ created_at: "2026-01-01T00:00:00Z" });
    expect(evaluate(ctx(), [newer, older]).winner?.id).toBe(older.id);
    const a = rule({ id: "a", created_at: "2025-01-01T00:00:00Z" });
    const b = rule({ id: "b", created_at: "2025-01-01T00:00:00Z" });
    expect(evaluate(ctx(), [b, a]).winner?.id).toBe("a");
  });
  it("is independent of input order (deterministic)", () => {
    const rules = Array.from({ length: 8 }, (_, i) => rule({ priority: i % 3, departments: i % 2 ? ["Sales"] : [] }));
    const expected = evaluate(ctx(), rules).winner?.id;
    for (let k = 0; k < 20; k++) {
      const shuffled = [...rules].sort(() => Math.random() - 0.5);
      expect(evaluate(ctx(), shuffled).winner?.id).toBe(expected);
    }
  });
  it("does not mutate its input", () => {
    const rules = [rule({ priority: 1 }), rule({ priority: 9 })];
    const copy = rules.map((r) => r.id);
    evaluate(ctx(), rules);
    expect(rules.map((r) => r.id)).toEqual(copy);
  });
  it("compareRules is antisymmetric", () => {
    const a = rule({ priority: 5 });
    const b = rule({ priority: 5, departments: ["x"] });
    expect(Math.sign(compareRules(a, b))).toBe(-Math.sign(compareRules(b, a)));
  });
  it("lists every matching rule, winner first", () => {
    const a = rule({ priority: 50 });
    const b = rule({ priority: 70 });
    expect(evaluate(ctx(), [a, b]).matched.map((r) => r.id)).toEqual([b.id, a.id]);
  });
});

describe("effectiveRules: brand templates become implicit low-priority rules", () => {
  const tpl = (o: Partial<TemplateLite> & { id: string }): TemplateLite => ({ name: o.id, departments: [], is_active: true, created_at: "2026-01-01T00:00:00Z", ...o });
  it("department template beats the default, default is the oldest template without departments", () => {
    const templates = [tpl({ id: "gen2", created_at: "2026-03-01T00:00:00Z" }), tpl({ id: "gen1", created_at: "2026-02-01T00:00:00Z" }), tpl({ id: "sales", departments: ["Sales"], created_at: "2026-04-01T00:00:00Z" })];
    const rules = effectiveRules([], templates);
    expect(evaluate(ctx({ department: "Sales" }), rules).winner?.template_id).toBe("sales");
    expect(evaluate(ctx({ department: "Ops" }), rules).winner?.template_id).toBe("gen1");
  });
  it("explicit rules rank above implicit ones; inactive templates are ignored", () => {
    const templates = [tpl({ id: "gen" }), tpl({ id: "off", departments: ["Sales"], is_active: false })];
    const explicit = rule({ template_id: "special", priority: 0 });
    const rules = effectiveRules([explicit], templates);
    expect(evaluate(ctx(), rules).winner?.template_id).toBe("special");
    expect(evaluate(ctx(), effectiveRules([], templates)).winner?.template_id).toBe("gen");
  });
  it("no active template and no rule means no winner", () => {
    expect(evaluate(ctx(), effectiveRules([], [tpl({ id: "x", is_active: false })])).winner).toBeNull();
  });
});

describe("what a target can honour", () => {
  it("Gmail honours only department/any rules", () => {
    expect(ruleSupport(rule({ departments: ["Sales"] }), "gmail").level).toBe("enforced");
    expect(ruleSupport(rule({ message_kind: "reply" }), "gmail").level).toBe("unsupported");
    expect(ruleSupport(rule({ audience: "external" }), "gmail").level).toBe("unsupported");
    const rules = [rule({ departments: ["Sales"] }), rule({ audience: "internal" }), rule({ message_kind: "new" })];
    expect(honoured(rules, "gmail")).toHaveLength(1);
  });
  it("Exchange: audience and department are enforced, new/reply unverified, forward unsupported", () => {
    expect(ruleSupport(rule({ audience: "internal", departments: ["x"] }), "exchange").level).toBe("enforced");
    expect(ruleSupport(rule({ message_kind: "reply" }), "exchange").level).toBe("unverified");
    expect(ruleSupport(rule({ message_kind: "new", audience: "external" }), "exchange").reasons[0]).toMatch(/unverified/);
    expect(ruleSupport(rule({ message_kind: "forward" }), "exchange").level).toBe("unsupported");
  });
});

describe("describeRule", () => {
  it("says what the rule does in a sentence", () => {
    expect(describeRule(rule({ message_kind: "reply", audience: "external", departments: ["Sales", "Ops"], priority: 7 }), "Sales look")).toBe(
      'Use "Sales look" for replies to people outside the organization from people in Sales or Ops. Priority 7.',
    );
    expect(describeRule(rule({ is_active: false }), "T")).toContain("switched off");
  });
});

describe("RuleInput", () => {
  const base = { name: "r", template_id: "8f1c2b9e-3d4a-4b7c-8e5f-0a1b2c3d4e5f" };
  it("applies defaults and de-duplicates departments", () => {
    const r = RuleInput.parse({ ...base, departments: ["Sales", "sales", "Ops"] });
    expect(r).toMatchObject({ message_kind: "any", audience: "any", priority: 100, is_active: true });
    expect(r.departments).toEqual(["sales", "Ops"]);
  });
  it("rejects commas, bad priority, bad template id", () => {
    expect(RuleInput.safeParse({ ...base, departments: ["A,B"] }).success).toBe(false);
    expect(RuleInput.safeParse({ ...base, priority: 1001 }).success).toBe(false);
    expect(RuleInput.safeParse({ ...base, priority: -1 }).success).toBe(false);
    expect(RuleInput.safeParse({ ...base, template_id: "nope" }).success).toBe(false);
    expect(RuleInput.safeParse({ ...base, message_kind: "bounce" }).success).toBe(false);
  });
});
