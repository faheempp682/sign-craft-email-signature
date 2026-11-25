import { createHash } from "node:crypto";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { effectiveRules, ruleSupport, sortRules, type Rule, type TemplateLite } from "@/lib/rules/evaluate";
import { buildDoc, type PersonData } from "@/lib/team/render";
import { validateSpec, type TemplateSpec } from "@/lib/team/template";

/**
 * Exchange Online / Microsoft 365: GENERATED, NOT RUN BY SIGNCRAFT.
 *
 * Microsoft offers no API to set a user's Outlook signature, and Microsoft Graph cannot manage mail flow (transport)
 * rules. The supported server-side route is an Exchange Online mail flow rule that appends an HTML disclaimer to
 * outgoing mail. This file turns approved brand templates into PowerShell (New-TransportRule / Set-TransportRule) that an
 * admin reviews and runs. Per-person data is filled in by Exchange from the sender's directory entry using tokens.
 *
 * Sources (read 2026; the Microsoft pages are the authority, check them again before relying on a detail):
 *  [1] Organization-wide message disclaimers, signatures, footers, or headers in Exchange Online
 *      https://learn.microsoft.com/exchange/security-and-compliance/mail-flow-rules/disclaimers-signatures-footers-or-headers
 *      - disclaimer text can contain HTML and inline CSS, images with the IMG tag
 *      - tokens: %%City%% %%Company%% %%CountryOrRegion%% %%Department%% %%DisplayName%% %%Fax%% %%FirstName%% %%HomePhone%%
 *        %%Initials%% %%LastName%% %%Manager%% %%MobilePhone%% %%Notes%% %%Office%% %%Pager%% %%Phone%% %%PostalCode%%
 *        %%PostOfficeBox%% %%StateOrProvince%% %%StreetAddress%% %%Title%% %%UserPrincipalName%% %%WindowsEmailAddress%%
 *      - fallback options Wrap (default), Ignore, Reject; Microsoft says not to use Wrap for incoming external mail
 *      - tip: add an exception that looks for unique text of the disclaimer so it is not added twice in a conversation
 *      - recommended: test with the rule in test mode before Enforce
 *  [2] New-TransportRule: https://learn.microsoft.com/powershell/module/exchangepowershell/new-transportrule
 *      - ApplyHtmlDisclaimerText: maximum 5000 characters; ApplyHtmlDisclaimerLocation Append | Prepend;
 *        ApplyHtmlDisclaimerFallbackAction Wrap | Ignore | Reject; Comments: at most 1024 characters
 *  [3] Mail flow rule conditions and exceptions (predicates)
 *      https://learn.microsoft.com/exchange/security-and-compliance/mail-flow-rules/conditions-and-exceptions
 *      - FromScope / SentToScope: InOrganization | NotInOrganization
 *      - SenderADAttributeContainsWords / SenderADAttributeMatchesPatterns, syntax "Attribute:Value1,Value2" ("Department" is an attribute)
 *      - HeaderMatchesMessageHeader + HeaderMatchesPatterns, and the ExceptIf versions (patterns are regular expressions, not case sensitive)
 *
 * NOT verified against a real tenant (the owner must test, see docs/deploy-and-rules.md): the Mode values Audit,
 * AuditAndNotify, Enforce and the Priority and StopRuleProcessing semantics are taken from the cmdlet's documented parameter
 * set but were not read on the page; tokens inside HTML attributes (href, src); the In-Reply-To header test for "new" versus
 * "reply"; how a message to inside AND outside recipients is split; the duplicate guard.
 */

export const DISCLAIMER_LIMIT = 5000;
export const COMMENTS_LIMIT = 1024;
export const RULE_PREFIX = "SignCraft - ";

/** Exchange token for each people field. A people field with no token cannot be filled by Exchange. */
export const TOKEN_FOR_FIELD: Record<string, string | null> = {
  full_name: "%%DisplayName%%",
  first_name: "%%FirstName%%",
  last_name: "%%LastName%%",
  email: "%%WindowsEmailAddress%%",
  title: "%%Title%%",
  department: "%%Department%%",
  phone: "%%Phone%%",
  mobile: "%%MobilePhone%%",
  location: "%%Office%%",
};

export type FallbackAction = "Wrap" | "Ignore" | "Reject";
export type RuleMode = "Audit" | "AuditAndNotify" | "Enforce";

export type ExchangeOptions = {
  /** Audit logs what would happen and changes nothing. The safe first step. */
  mode: RuleMode;
  /**
   * What Exchange does if it cannot add the HTML (encrypted or signed messages). Ignore is the safe default: the mail
   * still goes out unchanged, just without the signature. Wrap would attach the original to a new message; Reject bounces the mail.
   */
  fallback: FallbackAction;
  /** "end": after every rule that exists when the script runs. Otherwise a fixed starting priority (0 = first). */
  priority: "end" | number;
  /** A phrase that appears in the signature text; messages that already contain it are skipped (Microsoft's duplicate tip). "" = off. */
  duplicateGuard: string;
};

export const DEFAULT_OPTIONS: ExchangeOptions = { mode: "Audit", fallback: "Ignore", priority: "end", duplicateGuard: "" };

export type TemplateRow = { id: string; name: string; doc_json: unknown; lock_json: unknown; field_map: unknown; departments: string[]; is_active: boolean; created_at: string };

export type RuleOut = {
  index: number;
  name: string;
  templateName: string;
  /** Plain-language summary line for the "what this will do" panel. */
  sentence: string;
  conditions: string[];
  unverified: string[];
  htmlLength: number;
};

export type ExchangeResult =
  | { ok: false; errors: string[] }
  | {
      ok: true;
      script: string;
      removalScript: string;
      rules: RuleOut[];
      warnings: string[];
      omitted: { name: string; reason: string }[];
      summary: string[];
      fingerprint: string;
    };

/* ------------------------------------------------------------------------ html */

/** The Exchange token version of a person: every field holds its token, so the real renderer produces the HTML with tokens in place. */
const EMAIL_SENTINEL = "windows-email-address@signcraft.invalid";
function tokenPerson(): PersonData {
  const t = TOKEN_FOR_FIELD;
  // the document schema insists on a real-looking address; the token is put in place after rendering
  return { email: EMAIL_SENTINEL, full_name: t.full_name!, first_name: t.first_name!, last_name: t.last_name!, title: t.title!, department: t.department!, phone: t.phone!, mobile: t.mobile!, location: t.location!, custom: {} };
}

const asciiOnly = (s: string) => s.replace(/[^\x00-\x7e]/g, (c) => `&#${c.codePointAt(0)};`);

/** Image sources and links the HTML points to. */
function urlsIn(html: string, attr: "src" | "href"): string[] {
  const out: string[] = [];
  const re = new RegExp(`${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, "gi");
  for (let m = re.exec(html); m; m = re.exec(html)) out.push((m[2] ?? m[3] ?? "").trim());
  return out;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1)/i;

/** Images must be public https URLs: Exchange cannot embed local files, and mail clients will not load http or private addresses. */
export function imageProblems(html: string): string[] {
  const problems: string[] = [];
  for (const src of urlsIn(html, "src")) {
    if (/^%%/.test(src)) continue;
    let u: URL | null = null;
    try {
      u = new URL(src);
    } catch {
      /* handled below */
    }
    if (!u) problems.push(`An image address is not a full web address: "${src.slice(0, 60)}". Images must be public https URLs (data: and relative addresses do not work in a mail flow rule).`);
    else if (u.protocol !== "https:") problems.push(`An image uses ${u.protocol.replace(":", "")}, not https: ${src.slice(0, 80)}. Use a public https URL.`);
    else if (PRIVATE_HOST.test(u.hostname)) problems.push(`An image points to a private address (${u.hostname}). Recipients outside your network cannot load it; use a public https URL.`);
  }
  return [...new Set(problems)];
}

export function specOf(t: TemplateRow): TemplateSpec | null {
  const r = validateSpec({ doc: t.doc_json, lock: t.lock_json, field_map: t.field_map ?? {} });
  return r.ok ? r.spec : null;
}

/** HTML for one template with Exchange tokens. Warns about mapped fields Exchange cannot fill. */
export function templateHtml(t: TemplateRow): { ok: true; html: string; warnings: string[] } | { ok: false; error: string } {
  const spec = specOf(t);
  if (!spec) return { ok: false, error: `The template "${t.name}" is not valid any more. Open it in Team, Brand templates and save it again.` };
  const warnings: string[] = [];
  for (const [key, source] of Object.entries(spec.field_map)) {
    if (!(source in TOKEN_FOR_FIELD)) warnings.push(`In "${t.name}", ${key} is filled from "${source}", which Exchange has no token for. That line is left out of the Exchange version.`);
  }
  // Unlock nothing: the Exchange version is the template as designed, with directory data for the mapped fields.
  const built = buildDoc({ ...spec, lock: { editable: [] } }, tokenPerson(), {});
  if (!built.ok) return { ok: false, error: `The template "${t.name}" cannot be built for Exchange: ${built.error}` };
  const html = asciiOnly(renderToEmailHtml(built.doc).replace(/\r?\n\s*/g, "").trim()).split(EMAIL_SENTINEL).join(TOKEN_FOR_FIELD.email!);
  return { ok: true, html, warnings };
}

/* --------------------------------------------------------------------- powershell */

/** A PowerShell single-quoted string literal. */
export const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** A regular expression that matches exactly `s` (the department names go into the AD attribute pattern). */
const reEscape = (s: string) => s.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
const safeName = (s: string) => s.replace(/[^\x20-\x7e]/g, "").replace(/[\\'"`$]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "rule";

type Built = { name: string; params: string[]; out: RuleOut; htmlVar: string; html: string };

export function generateExchange(input: { rules: Rule[]; templates: TemplateRow[]; options?: Partial<ExchangeOptions>; generatedAt?: string }): ExchangeResult {
  const o: ExchangeOptions = { ...DEFAULT_OPTIONS, ...input.options };
  const errors: string[] = [];
  const warnings: string[] = [];
  const omitted: { name: string; reason: string }[] = [];

  if (o.priority !== "end" && (!Number.isInteger(o.priority) || o.priority < 0 || o.priority > 10_000)) errors.push("The priority must be a whole number from 0 up, or \"end\".");
  if (/[\r\n"'`$]/.test(o.duplicateGuard) || o.duplicateGuard.length > 100) errors.push("The duplicate-guard phrase must be at most 100 characters and cannot contain quotes, $ or line breaks.");

  const lite: TemplateLite[] = input.templates.map((t) => ({ id: t.id, name: t.name, departments: t.departments, is_active: t.is_active, created_at: t.created_at }));
  const all = sortRules(effectiveRules(input.rules.filter((r) => r.is_active), lite));
  const carried: Rule[] = [];
  for (const r of all) {
    const s = ruleSupport(r, "exchange");
    if (s.level === "unsupported") omitted.push({ name: r.name, reason: `Exchange cannot express it (${s.reasons.join("; ")}). It is left out of the script.` });
    else carried.push(r);
  }
  if (!carried.length) errors.push("There is nothing to generate: no active brand template or rule. Create a brand template first.");

  const byId = new Map(input.templates.map((t) => [t.id, t]));
  const htmlCache = new Map<string, { html: string } | { error: string }>();
  const seenWarn = new Set<string>();
  const built: Built[] = [];

  carried.forEach((r, index) => {
    const t = byId.get(r.template_id);
    if (!t || !t.is_active) {
      errors.push(`The rule "${r.name}" uses a template that is missing or switched off.`);
      return;
    }
    let h = htmlCache.get(t.id);
    if (!h) {
      const r2 = templateHtml(t);
      if (r2.ok) {
        for (const w of r2.warnings) {
          if (seenWarn.has(w)) continue;
          seenWarn.add(w);
          warnings.push(w);
        }
        const issues = imageProblems(r2.html);
        h = issues.length ? { error: `Template "${t.name}": ${issues.join(" ")}` } : r2.html.length > DISCLAIMER_LIMIT ? { error: `The signature for template "${t.name}" is ${r2.html.length.toLocaleString("en-GB")} characters, over Exchange's ${DISCLAIMER_LIMIT.toLocaleString("en-GB")} character limit for disclaimer text. Remove a block, use a smaller banner, or shorten text, then generate again.` } : { html: r2.html };
      } else h = { error: r2.error };
      htmlCache.set(t.id, h);
    }
    if ("error" in h) {
      if (!errors.includes(h.error)) errors.push(h.error);
      return;
    }
    if (h.html.length > DISCLAIMER_LIMIT - 300) {
      const w = `The signature for "${t.name}" is ${h.html.length.toLocaleString("en-GB")} of ${DISCLAIMER_LIMIT.toLocaleString("en-GB")} characters. Exchange fills in the directory values when it sends; whether those count against the limit is not documented, so keep some room.`;
      if (!seenWarn.has(w)) {
        seenWarn.add(w);
        warnings.push(w);
      }
    }

    const name = `${RULE_PREFIX}${String(index + 1).padStart(2, "0")} ${safeName(r.name)}`;
    const conds: string[] = ["the sender is inside your organization (FromScope InOrganization)"];
    const params = [`FromScope = 'InOrganization'`];
    const unverified: string[] = [];
    if (r.audience !== "any") {
      params.push(`SentToScope = '${r.audience === "internal" ? "InOrganization" : "NotInOrganization"}'`);
      conds.push(`the recipient is ${r.audience === "internal" ? "inside" : "outside"} your organization (SentToScope)`);
    }
    if (r.departments.length) {
      params.push(`SenderADAttributeMatchesPatterns = @(${psq(`Department:${r.departments.map((d) => `^${reEscape(d)}$`).join(",")}`)})`);
      conds.push(`the sender's Department is exactly ${r.departments.join(" or ")}`);
    }
    if (r.message_kind === "reply") {
      params.push(`HeaderMatchesMessageHeader = 'In-Reply-To'`, `HeaderMatchesPatterns = @('.+')`);
      conds.push("the message has an In-Reply-To header (a reply)");
      unverified.push("reply detection uses the In-Reply-To header");
    } else if (r.message_kind === "new") {
      params.push(`ExceptIfHeaderMatchesMessageHeader = 'In-Reply-To'`, `ExceptIfHeaderMatchesPatterns = @('.+')`);
      conds.push("the message has no In-Reply-To header (a new message)");
      unverified.push("new-message detection uses the missing In-Reply-To header");
    }
    if (o.duplicateGuard) {
      params.push(`ExceptIfSubjectOrBodyContainsWords = @(${psq(o.duplicateGuard)})`);
      conds.push(`the subject or body does not already contain "${o.duplicateGuard}"`);
      unverified.push("the duplicate guard");
    }
    const sentence = `${r.implicit ? "Default" : "Rule"} ${index + 1} "${r.name}": append "${t.name}" when ${conds.join(", and ")}.`;
    built.push({ name, params, htmlVar: `$html_${t.id.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`, html: h.html, out: { index: index + 1, name, templateName: t.name, sentence, conditions: conds, unverified, htmlLength: h.html.length } });
  });

  if (errors.length) return { ok: false, errors };

  // one here-string per template (HTML is one line, so "'@" can never begin a line inside it)
  const htmlVars = new Map<string, string>();
  for (const b of built) if (!htmlVars.has(b.htmlVar)) htmlVars.set(b.htmlVar, b.html);

  const fingerprint = createHash("sha256").update(JSON.stringify([o, built.map((b) => [b.name, b.params, b.html])])).digest("hex");
  const stamp = input.generatedAt ?? new Date().toISOString();
  const comment = `Generated by SignCraft ${stamp.slice(0, 10)} (plan ${fingerprint.slice(0, 12)}). Do not edit by hand; regenerate.`;

  const lines: string[] = [];
  lines.push(
    "<#",
    "  SignCraft: Exchange Online mail flow rule script",
    "  GENERATED, NOT RUN BY SIGNCRAFT. Read it, then run it yourself in a PowerShell session you control.",
    "",
    "  What it does: creates or updates one mail flow (transport) rule per signature below. Each rule appends an HTML",
    "  signature to mail sent by people inside your organization. Exchange fills %%tokens%% from the sender's directory entry.",
    `  Mode: ${o.mode}. ${o.mode === "Audit" ? "Audit only logs what WOULD happen. Nothing is added to any message until you switch to Enforce." : o.mode === "Enforce" ? "ENFORCE: signatures are added to real mail as soon as the rules exist." : "Audit and notify: logs and notifies, nothing is added."}`,
    `  If the HTML cannot be added (encrypted or signed mail): ${o.fallback}.`,
    "  Sources: https://learn.microsoft.com/exchange/security-and-compliance/mail-flow-rules/disclaimers-signatures-footers-or-headers",
    "           https://learn.microsoft.com/powershell/module/exchangepowershell/new-transportrule",
    "  Needs: the ExchangeOnlineManagement module and a role that can manage mail flow rules (Organization Management).",
    "  Remove everything this script made with the SignCraft removal script.",
    "#>",
    "",
    "#Requires -Modules ExchangeOnlineManagement",
    "$ErrorActionPreference = 'Stop'",
    "if (-not (Get-ConnectionInformation -ErrorAction SilentlyContinue)) { Connect-ExchangeOnline }",
    "",
    `$prefix = ${psq(RULE_PREFIX)}`,
    `$comment = ${psq(comment.slice(0, COMMENTS_LIMIT))}`,
  );
  for (const [v, html] of htmlVars) lines.push("", `${v} = @'`, html, "'@");
  lines.push("");
  if (o.priority === "end") lines.push("# Our rules go after every rule that already exists, so they never change how your other rules behave.", "$base = @(Get-TransportRule | Where-Object { $_.Name -notlike ($prefix + '*') }).Count");
  else lines.push(`$base = ${o.priority}`);
  lines.push("$names = @()", "");
  for (const b of built) {
    lines.push(`# ${b.out.sentence.replace(/[\r\n]+/g, " ")}`);
    if (b.out.unverified.length) lines.push(`# UNVERIFIED against a real tenant: ${b.out.unverified.join("; ")}.`);
    lines.push(
      "$p = @{",
      ...b.params.map((p) => `  ${p}`),
      `  ApplyHtmlDisclaimerText = ${b.htmlVar}`,
      "  ApplyHtmlDisclaimerLocation = 'Append'",
      `  ApplyHtmlDisclaimerFallbackAction = '${o.fallback}'`,
      `  Mode = '${o.mode}'`,
      `  Priority = $base + ${b.out.index - 1}`,
      "  StopRuleProcessing = $true   # the first matching SignCraft rule wins; later ones are not applied",
      "  Comments = $comment",
      "}",
      `$name = ${psq(b.name)}`,
      "$names += $name",
      "if (Get-TransportRule -Identity $name -ErrorAction SilentlyContinue) { Set-TransportRule -Identity $name @p } else { New-TransportRule -Name $name @p }",
      "",
    );
  }
  lines.push(
    "# Rules from an earlier run that are no longer part of this set (you are asked before each one is removed).",
    "Get-TransportRule | Where-Object { $_.Name -like ($prefix + '*') -and $names -notcontains $_.Name } | ForEach-Object { Remove-TransportRule -Identity $_.Identity -Confirm:$true }",
    "",
    "Get-TransportRule | Where-Object { $_.Name -like ($prefix + '*') } | Sort-Object Priority | Format-Table Name, Priority, Mode, State",
    `Write-Host 'Done. Mode is ${o.mode}.${o.mode === "Enforce" ? "" : " Review the message trace, then re-run the generated script with Enforce to turn it on."}'`,
  );
  const script = lines.join("\r\n") + "\r\n";

  const removalScript = [
    "<#",
    "  SignCraft: remove every mail flow rule made by the SignCraft Exchange script.",
    "  GENERATED, NOT RUN BY SIGNCRAFT. It asks before removing each rule. Rules whose name does not start with the prefix are never touched.",
    "#>",
    "#Requires -Modules ExchangeOnlineManagement",
    "$ErrorActionPreference = 'Stop'",
    "if (-not (Get-ConnectionInformation -ErrorAction SilentlyContinue)) { Connect-ExchangeOnline }",
    `$prefix = ${psq(RULE_PREFIX)}`,
    "Get-TransportRule | Where-Object { $_.Name -like ($prefix + '*') } | ForEach-Object { Remove-TransportRule -Identity $_.Identity -Confirm:$true }",
    "",
  ].join("\r\n");

  const summary = [
    `Creates or updates ${built.length} mail flow rule${built.length === 1 ? "" : "s"} in Exchange Online, named "${RULE_PREFIX}01 ..." and so on.`,
    o.mode === "Audit" ? "Starts in Audit mode: Exchange only logs what it would do. No message is changed until you switch the rules to Enforce." : o.mode === "Enforce" ? "Starts in Enforce mode: real outgoing mail gets the signature straight away." : "Starts in Audit and notify mode: logged, no message is changed.",
    "Only mail sent by people inside your organization is touched. Mail you receive is never changed.",
    `The signature is appended to the end of the message. If Exchange cannot add it (encrypted or signed mail): ${o.fallback === "Ignore" ? "the mail is sent unchanged, without the signature" : o.fallback === "Wrap" ? "the mail is attached to a new message that carries the signature (Microsoft advises against this for incoming mail; these rules only affect outgoing)" : "the mail is bounced back to the sender"}.`,
    "Each person's name, title, phone and so on come from their entry in your Microsoft 365 directory when the mail is sent. If a directory field is empty, its place in the signature is blank.",
    "Rules are checked in order and the first one that matches wins; later SignCraft rules are skipped for that message.",
    "People who also have an Outlook signature of their own will get both, unless they remove theirs.",
  ];

  return {
    ok: true,
    script,
    removalScript,
    rules: built.map((b) => b.out),
    warnings,
    omitted,
    summary,
    fingerprint,
  };
}

/* ---------------------------------------------------------- read-only directory export */

/**
 * A read-only PowerShell helper that exports the directory attributes SignCraft's CSV import accepts. It only reads
 * (Get-User) and writes a local CSV file. UNVERIFIED against a tenant: the property names are those of Get-User
 * (https://learn.microsoft.com/powershell/module/exchangepowershell/get-user, which lists no property table; they follow the
 * attribute names Exchange uses for the disclaimer tokens).
 */
export function directoryExportScript(): string {
  return [
    "<#",
    "  SignCraft: export your Microsoft 365 directory to a CSV for the SignCraft people import (Team, Import).",
    "  READ ONLY: it only reads users and writes one local file. It changes nothing in Microsoft 365.",
    "  GENERATED, NOT RUN BY SIGNCRAFT. Untested against a real tenant: check the CSV before importing.",
    "#>",
    "#Requires -Modules ExchangeOnlineManagement",
    "$ErrorActionPreference = 'Stop'",
    "if (-not (Get-ConnectionInformation -ErrorAction SilentlyContinue)) { Connect-ExchangeOnline }",
    "$out = Join-Path (Get-Location) 'signcraft-people.csv'",
    "Get-User -ResultSize Unlimited -RecipientTypeDetails UserMailbox |",
    "  Where-Object { $_.WindowsEmailAddress } |",
    "  Select-Object @{n='Email';e={[string]$_.WindowsEmailAddress}}, @{n='Full name';e={$_.DisplayName}}, @{n='First name';e={$_.FirstName}}, @{n='Last name';e={$_.LastName}},",
    "    @{n='Job title';e={$_.Title}}, @{n='Department';e={$_.Department}}, @{n='Phone';e={$_.Phone}}, @{n='Mobile';e={$_.MobilePhone}}, @{n='Location';e={$_.Office}},",
    "    @{n='Status';e={ if ($_.AccountDisabled) { 'inactive' } else { 'active' } }} |",
    "  Export-Csv -Path $out -NoTypeInformation -Encoding UTF8",
    "Write-Host \"Wrote $out. Open it, check it, then upload it in SignCraft under Team, Import.\"",
    "",
  ].join("\r\n");
}
