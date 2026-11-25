import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { checkValues } from "./brand-lock";
import { FIELD_RULES, fieldKey, validateSpec, type TemplateSpec } from "./template";

/** The people fields a template can read. */
export type PersonData = {
  email: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  department?: string;
  phone?: string;
  mobile?: string;
  location?: string;
  custom?: Record<string, string>;
};

export function personValue(person: PersonData, source: string): string {
  if (source.startsWith("custom.")) return (person.custom?.[source.slice(7)] ?? "").trim();
  const v = (person as Record<string, unknown>)[source];
  return typeof v === "string" ? v.trim() : "";
}

export type BuildResult = { ok: true; doc: SignatureDoc } | { ok: false; error: string; key?: string };

/**
 * The document for one person: the template's document, then for every editable text field
 *   1. the employee's value, if they gave one (and the field is unlocked),
 *   2. otherwise the directory value the field is mapped to (an empty directory value removes an optional field,
 *      so a template's example phone number never ends up in a real person's signature),
 *   3. otherwise the template's own text.
 * Locked fields can only come from the directory or the template. Employee values for locked fields are an error.
 * The result is validated with the same schema the editor uses.
 */
export function buildDoc(spec: TemplateSpec, person: PersonData, values: Record<string, string> = {}): BuildResult {
  const violations = checkValues(spec, values);
  if (violations.length) return { ok: false, error: violations[0].message, key: violations[0].key };
  const editable = new Set(spec.lock.editable);
  const doc = structuredClone(spec.doc) as SignatureDoc;

  for (let i = 0; i < doc.blocks.length; i++) {
    const block = doc.blocks[i] as Record<string, unknown> & { type: string };
    for (const [field, rule] of Object.entries(FIELD_RULES[block.type] ?? {})) {
      const key = fieldKey(i, field);
      let next: string | undefined;
      if (editable.has(key) && Object.prototype.hasOwnProperty.call(values, key)) next = values[key].trim();
      else if (spec.field_map[key]) next = personValue(person, spec.field_map[key]);
      if (next === undefined) continue;
      if (next === "") {
        if (rule.required) return { ok: false, error: `${rule.label} is empty. Add it to the directory entry.`, key };
        delete block[field];
      } else block[field] = next;
    }
  }
  const parsed = SignatureDocSchema.safeParse(doc);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".");
    return { ok: false, error: `The signature would not be valid (${path || "document"}: ${issue.message}).`, key: path };
  }
  return { ok: true, doc: parsed.data };
}

/** HTML for one person, produced by the real renderer from a document built on the server. Never accepts HTML from a client. */
export function renderForPerson(spec: TemplateSpec, person: PersonData, values: Record<string, string> = {}): { ok: true; doc: SignatureDoc; html: string } | { ok: false; error: string; key?: string } {
  const built = buildDoc(spec, person, values);
  if (!built.ok) return built;
  return { ok: true, doc: built.doc, html: renderToEmailHtml(built.doc) };
}

/** The template copy stored with a submitted version (made inside the database), as a validated spec. null when it no longer validates. */
export function specFromSnapshot(snapshot: unknown): TemplateSpec | null {
  const s = (snapshot && typeof snapshot === "object" ? snapshot : {}) as { doc?: unknown; lock?: unknown; field_map?: unknown };
  const r = validateSpec({ doc: s.doc, lock: s.lock, field_map: s.field_map ?? {} });
  return r.ok ? r.spec : null;
}

/** HTML for a stored version: its own template copy + the person's current directory data + the values the employee submitted. */
export function renderVersion(version: { template_snapshot: unknown; values_json: unknown }, person: PersonData) {
  const spec = specFromSnapshot(version.template_snapshot);
  if (!spec) return { ok: false as const, error: "The stored template is no longer valid." };
  const values = version.values_json && typeof version.values_json === "object" ? (version.values_json as Record<string, string>) : {};
  return renderForPerson(spec, person, values);
}
