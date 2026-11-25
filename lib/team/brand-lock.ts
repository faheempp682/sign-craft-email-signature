import type { SignatureDoc } from "@/lib/schema/document";
import { buildDoc, type PersonData } from "./render";
import { FIELD_RULES, KEY_RE, type TemplateSpec } from "./template";

/**
 * Brand lock: the server (and later the editor) asks these functions whether a change stays inside what the template
 * allows. Both functions answer with a list of violations; an empty list means allowed.
 */

export type Violation = { key: string; message: string };

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Validate an employee's submitted values: only unlocked keys, only strings, within each field's length, no control characters. */
export function checkValues(spec: TemplateSpec, values: unknown): Violation[] {
  if (!values || typeof values !== "object" || Array.isArray(values)) return [{ key: "", message: "The values must be an object." }];
  const editable = new Set(spec.lock.editable);
  const out: Violation[] = [];
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (!KEY_RE.test(key) || !editable.has(key)) {
      out.push({ key, message: "That field is locked by your organization's brand template." });
      continue;
    }
    const [indexStr, field] = key.split(".");
    const block = spec.doc.blocks[Number(indexStr)];
    const rule = block ? FIELD_RULES[block.type]?.[field] : undefined;
    if (!rule) {
      out.push({ key, message: "That field does not exist." });
      continue;
    }
    if (typeof value !== "string") out.push({ key, message: "The value must be text." });
    else if (value.length > rule.max) out.push({ key, message: `${rule.label} can be at most ${rule.max} characters.` });
    else if (CONTROL.test(value) || (!rule.multiline && /[\r\n]/.test(value))) out.push({ key, message: `${rule.label} contains characters that are not allowed.` });
    else if (rule.required && value.trim() === "") out.push({ key, message: `${rule.label} cannot be empty.` });
  }
  return out;
}

/** Paths that differ between two documents: "<blockIndex>.<field>", "theme.<name>", "template_id", "variant" or "blocks". */
export function diffDocs(a: SignatureDoc, b: SignatureDoc): string[] {
  const out: string[] = [];
  if (a.template_id !== b.template_id) out.push("template_id");
  if (a.variant !== b.variant) out.push("variant");
  for (const k of new Set([...Object.keys(a.theme), ...Object.keys(b.theme)])) {
    if ((a.theme as Record<string, unknown>)[k] !== (b.theme as Record<string, unknown>)[k]) out.push(`theme.${k}`);
  }
  if (a.blocks.length !== b.blocks.length) return [...out, "blocks"];
  a.blocks.forEach((blockA, i) => {
    const blockB = b.blocks[i];
    if (blockA.type !== blockB.type) {
      out.push(`${i}.type`);
      return;
    }
    const x = blockA as Record<string, unknown>;
    const y = blockB as Record<string, unknown>;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(`${i}.${k}`);
    }
  });
  return out;
}

/**
 * An edited document must differ from what the template produces for this person only in unlocked fields.
 * `currentValues` are the values already approved (so the employee's earlier edits are not counted as new changes).
 */
export function checkEditedDoc(spec: TemplateSpec, person: PersonData, edited: SignatureDoc, currentValues: Record<string, string> = {}): Violation[] {
  const base = buildDoc(spec, person, currentValues);
  if (!base.ok) return [{ key: "", message: base.error }];
  const editable = new Set(spec.lock.editable);
  return diffDocs(base.doc, edited)
    .filter((path) => !editable.has(path))
    .map((path) => ({ key: path, message: "That part of the signature is locked by your organization's brand template." }));
}
