import { describe, expect, it } from "vitest";
import type { SignatureDoc } from "@/lib/schema/document";
import type { Rule } from "@/lib/rules/evaluate";
import { DISCLAIMER_LIMIT, directoryExportScript, generateExchange, imageProblems, psq, templateHtml, type TemplateRow } from "./exchange";

const DOC: SignatureDoc = {
  version: 1,
  template_id: "classic",
  theme: { primary: "#1E3A8A", text: "#111827", muted: "#6B7280", bg: "#FFFFFF", accent2: "#F4C542", font: "Arial", spacing: "normal" },
  blocks: [
    { type: "avatar", src: "https://cdn.example.com/a.png", alt: "", shape: "circle", size: 80 },
    { type: "identity", name: "Template Name", title: "Template Title", company: "Acme Cörp" },
    { type: "contact", phone: "+1 000 000", email: "template@acme.com", website: "acme.com" },
    { type: "disclaimer", text: "Confidential." },
  ],
};
const tpl = (o: Partial<TemplateRow> = {}): TemplateRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Standard",
  doc_json: DOC,
  lock_json: { editable: [] },
  field_map: { "1.name": "full_name", "1.title": "title", "2.phone": "phone", "2.email": "email" },
  departments: [],
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  ...o,
});
let n = 0;
const rule = (o: Partial<Rule> = {}): Rule => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, name: "Rule", message_kind: "any", audience: "any", departments: [], priority: 100, template_id: "11111111-1111-4111-8111-111111111111", is_active: true, created_at: "2026-02-01T00:00:00Z", ...o });

function gen(rules: Rule[] = [], templates: TemplateRow[] = [tpl()], options = {}) {
  const r = generateExchange({ rules, templates, options, generatedAt: "2026-06-01T00:00:00Z" });
  if (!r.ok) throw new Error(r.errors.join(" | "));
  return r;
}

describe("template html with Exchange tokens", () => {
  it("uses the documented tokens for mapped people fields and keeps locked template text", () => {
    const r = templateHtml(tpl());
    if (!r.ok) throw new Error(r.error);
    for (const t of ["%%DisplayName%%", "%%Title%%", "%%Phone%%", "%%WindowsEmailAddress%%"]) expect(r.html).toContain(t);
    expect(r.html).not.toContain("Template Name");
    expect(r.html).toContain("Confidential.");
  });
  it("is pure ASCII (non-ASCII becomes numeric entities) and one line", () => {
    const r = templateHtml(tpl());
    if (!r.ok) throw new Error(r.error);
    expect(r.html).toMatch(/^[\x20-\x7e]*$/);
    expect(r.html).toContain("Acme C&#246;rp");
  });
  it("warns when a field is filled from something Exchange has no token for", () => {
    const r = templateHtml(tpl({ field_map: { "1.name": "full_name", "1.title": "custom.badge" } }));
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings.join(" ")).toMatch(/no token/);
  });
  it("reports an invalid stored template", () => {
    expect(templateHtml(tpl({ doc_json: { nope: true } })).ok).toBe(false);
  });
});

describe("images", () => {
  it("accepts public https, rejects http, data:, relative and private hosts", () => {
    expect(imageProblems('<img src="https://cdn.example.com/a.png">')).toEqual([]);
    expect(imageProblems('<img src="http://cdn.example.com/a.png">')[0]).toMatch(/not https/);
    expect(imageProblems('<img src="data:image/png;base64,AAA">')[0]).toMatch(/not a full web address|not https/);
    expect(imageProblems('<img src="/logo.png">')[0]).toMatch(/not a full web address/);
    expect(imageProblems('<img src="https://localhost/a.png">')[0]).toMatch(/private/);
    expect(imageProblems("<img src='https://192.168.1.4/a.png'>")[0]).toMatch(/private/);
  });
  it("generation fails with a clear error for a non-https image", () => {
    const bad = tpl({ doc_json: { ...DOC, blocks: [{ type: "avatar", src: "http://cdn.example.com/a.png", alt: "", shape: "circle", size: 80 }, ...DOC.blocks.slice(1)] } });
    const r = generateExchange({ rules: [], templates: [bad] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/Standard/);
  });
});

describe("size limit", () => {
  it("refuses a template whose HTML is over 5000 characters with a clear error", () => {
    const big = tpl({ doc_json: { ...DOC, blocks: [...DOC.blocks.slice(0, 3), ...[1, 2, 3, 4].map(() => ({ type: "disclaimer" as const, text: "x ".repeat(700) }))] } });
    const html = templateHtml(big);
    if (!html.ok) throw new Error(html.error);
    expect(html.html.length).toBeGreaterThan(DISCLAIMER_LIMIT);
    const r = generateExchange({ rules: [], templates: [big] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/over Exchange's 5,000 character limit/);
  });
  it("a normal template is under the limit and reports its length", () => {
    const r = gen();
    expect(r.rules[0].htmlLength).toBeLessThan(DISCLAIMER_LIMIT);
  });
});

describe("script contents and safe defaults", () => {
  it("defaults to Audit mode, fallback Ignore, appended after all existing rules, labelled generated-not-run", () => {
    const r = gen();
    expect(r.script).toContain("Mode = 'Audit'");
    expect(r.script).toContain("ApplyHtmlDisclaimerFallbackAction = 'Ignore'");
    expect(r.script).toContain("ApplyHtmlDisclaimerLocation = 'Append'");
    expect(r.script).toContain("GENERATED, NOT RUN BY SIGNCRAFT");
    expect(r.script).toContain("Where-Object { $_.Name -notlike ($prefix + '*') }).Count");
    expect(r.script).toContain("FromScope = 'InOrganization'");
    expect(r.summary.join(" ")).toMatch(/Audit mode/);
  });
  it("only SignCraft-prefixed rules are ever removed", () => {
    const r = gen();
    expect(r.removalScript).toContain("-like ($prefix + '*')");
    expect(r.removalScript).toContain("-Confirm:$true");
    expect(r.removalScript).not.toMatch(/Remove-TransportRule -Identity \*/);
  });
  it("Enforce, Wrap and a fixed priority are written when chosen", () => {
    const r = gen([], [tpl()], { mode: "Enforce", fallback: "Wrap", priority: 3 });
    expect(r.script).toContain("Mode = 'Enforce'");
    expect(r.script).toContain("ApplyHtmlDisclaimerFallbackAction = 'Wrap'");
    expect(r.script).toContain("$base = 3");
    expect(r.summary.join(" ")).toMatch(/real outgoing mail/);
  });
  it("rejects a bad priority and a dangerous duplicate-guard phrase", () => {
    expect(generateExchange({ rules: [], templates: [tpl()], options: { priority: -1 } }).ok).toBe(false);
    expect(generateExchange({ rules: [], templates: [tpl()], options: { duplicateGuard: "x'; Remove-Item *" } }).ok).toBe(false);
  });
  it("is pure ASCII so PowerShell 5.1 reads it correctly", () => {
    expect(gen().script).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
  });
  it("is deterministic for the same input", () => {
    expect(gen().script).toBe(gen().script);
    expect(gen().fingerprint).toBe(gen().fingerprint);
  });
  it("fails clearly when there is no template", () => {
    const r = generateExchange({ rules: [], templates: [] });
    expect(r.ok).toBe(false);
  });
  it("quotes PowerShell strings safely", () => {
    expect(psq("it's")).toBe("'it''s'");
  });
});

describe("rules in the script", () => {
  const eng = tpl({ id: "22222222-2222-4222-8222-222222222222", name: "Engineering", created_at: "2026-03-01T00:00:00Z" });
  it("internal and external become recipient scope conditions", () => {
    const r = gen([rule({ name: "Ext", audience: "external", priority: 50 }), rule({ name: "Int", audience: "internal", priority: 40 })]);
    expect(r.script).toContain("SentToScope = 'NotInOrganization'");
    expect(r.script).toContain("SentToScope = 'InOrganization'");
  });
  it("departments become anchored, escaped AD attribute patterns", () => {
    const r = gen([rule({ departments: ["R&D (EU)", "Sales"] })]);
    expect(r.script).toContain("SenderADAttributeMatchesPatterns = @('Department:^R&D \\(EU\\)$,^Sales$')");
    expect(r.rules[0].conditions.join(" ")).toContain("exactly R&D (EU) or Sales");
  });
  it("new and reply use the In-Reply-To header and are labelled unverified; forward is left out", () => {
    const r = gen([rule({ name: "Reply", message_kind: "reply", priority: 60 }), rule({ name: "New", message_kind: "new", priority: 50 }), rule({ name: "Fwd", message_kind: "forward", priority: 70 })]);
    expect(r.script).toContain("HeaderMatchesMessageHeader = 'In-Reply-To'");
    expect(r.script).toContain("ExceptIfHeaderMatchesMessageHeader = 'In-Reply-To'");
    expect(r.script).toMatch(/UNVERIFIED against a real tenant: reply detection/);
    expect(r.omitted.map((o) => o.name)).toEqual(["Fwd"]);
    expect(r.script).not.toContain("Fwd");
  });
  it("writes rules in the evaluator's order, highest priority first, default last", () => {
    const r = gen([rule({ name: "Low", priority: 10 }), rule({ name: "High", priority: 900, template_id: eng.id })], [tpl(), eng]);
    const names = r.rules.map((x) => x.sentence);
    expect(names[0]).toContain("High");
    expect(names[1]).toContain("Low");
    expect(names[names.length - 1]).toContain("Default");
    expect(r.script.indexOf("Priority = $base + 0")).toBeLessThan(r.script.indexOf("Priority = $base + 1"));
  });
  it("a department template becomes a department rule and the oldest general one is the default", () => {
    const r = gen([], [tpl(), tpl({ id: "33333333-3333-4333-8333-333333333333", name: "Sales look", departments: ["Sales"] })]);
    expect(r.rules).toHaveLength(2);
    expect(r.script).toContain("Department:^Sales$");
  });
  it("a rule pointing at a switched-off template is an error", () => {
    const r = generateExchange({ rules: [rule({ template_id: eng.id })], templates: [tpl(), { ...eng, is_active: false }] });
    expect(r.ok).toBe(false);
  });
  it("duplicate guard adds an exception", () => {
    expect(gen([], [tpl()], { duplicateGuard: "Acme Corp" }).script).toContain("ExceptIfSubjectOrBodyContainsWords = @('Acme Corp')");
  });
  it("the HTML of each template is written once, in a verbatim here-string", () => {
    const r = gen([rule({ priority: 5 }), rule({ priority: 4 })]);
    expect(r.script.match(/@'\r\n/g)?.length).toBe(1);
  });
});

describe("directory export helper", () => {
  it("is read-only and uses headers the CSV import recognises", async () => {
    const s = directoryExportScript();
    expect(s).toMatch(/READ ONLY/);
    expect(s).not.toMatch(/Set-|New-|Remove-(?!TransportRule)/);
    const { autoMap } = await import("@/lib/team/people");
    const headers = ["Email", "Full name", "First name", "Last name", "Job title", "Department", "Phone", "Mobile", "Location", "Status"];
    for (const h of headers) expect(s).toContain(`n='${h}'`);
    const m = autoMap(headers);
    expect(Object.values(m)).toEqual(["email", "full_name", "first_name", "last_name", "title", "department", "phone", "mobile", "location", "status"]);
  });
});
