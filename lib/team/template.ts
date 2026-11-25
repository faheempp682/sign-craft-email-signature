import { z } from "zod";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";

/**
 * A brand template = a signature document + a lock specification + a field map.
 *
 * Field keys are "<blockIndex>.<field>", for example "0.title" (block 0, field title). The lock lists the keys an
 * employee MAY change; everything else (logo, banner image and link, colours, fonts, layout, social links, which blocks
 * exist) is locked, and is never offered because only the text fields below can be unlocked at all.
 */

export type FieldRule = { label: string; max: number; multiline?: boolean; required?: boolean; email?: boolean };

/** The only block fields that can ever be edited by an employee. Images, links, shapes and the theme are never unlockable. */
export const FIELD_RULES: Record<string, Record<string, FieldRule>> = {
  identity: {
    name: { label: "Name", max: 100, required: true },
    title: { label: "Job title", max: 100 },
    company: { label: "Company", max: 100 },
  },
  contact: {
    phone: { label: "Phone", max: 40 },
    email: { label: "Email", max: 254, email: true },
    website: { label: "Website", max: 200 },
    address: { label: "Address", max: 200 },
  },
  avatar: { alt: { label: "Photo description", max: 120 } },
  banner: { alt: { label: "Banner description", max: 160 } },
  disclaimer: { text: { label: "Disclaimer", max: 1500, multiline: true } },
};

export const BLOCK_LABEL: Record<string, string> = { identity: "Identity", contact: "Contact", avatar: "Photo", banner: "Banner", disclaimer: "Disclaimer", social: "Social links", divider: "Divider" };

/** People fields a block field can be filled from. */
export const PERSON_SOURCES = {
  full_name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  title: "Job title",
  department: "Department",
  phone: "Phone",
  mobile: "Mobile",
  location: "Location",
} as const;

const CUSTOM_SOURCE = /^custom\.[a-z][a-z0-9_]{0,29}$/;
export const isPersonSource = (s: string) => s in PERSON_SOURCES || CUSTOM_SOURCE.test(s);

export const KEY_RE = /^\d{1,2}\.[a-z_]{1,20}$/;

export type LockSpec = { editable: string[] };
export type FieldMap = Record<string, string>;
export type TemplateSpec = { doc: SignatureDoc; lock: LockSpec; field_map: FieldMap };

export const LockSpecSchema = z.object({ editable: z.array(z.string().regex(KEY_RE)).max(40) });
export const FieldMapSchema = z.record(z.string().regex(KEY_RE), z.string().max(40));

export const fieldKey = (index: number, field: string) => `${index}.${field}`;

/** Every (key, rule, block type) a document offers, in document order. */
export function lockableFields(doc: SignatureDoc): { key: string; index: number; type: string; field: string; rule: FieldRule }[] {
  const out: { key: string; index: number; type: string; field: string; rule: FieldRule }[] = [];
  doc.blocks.forEach((b, index) => {
    for (const [field, rule] of Object.entries(FIELD_RULES[b.type] ?? {})) out.push({ key: fieldKey(index, field), index, type: b.type, field, rule });
  });
  return out;
}

export function validateSpec(input: { doc: unknown; lock: unknown; field_map: unknown }): { ok: true; spec: TemplateSpec } | { ok: false; error: string } {
  const doc = SignatureDocSchema.safeParse(input.doc);
  if (!doc.success) return { ok: false, error: `The signature is not valid: ${doc.error.issues[0]?.message ?? "unknown problem"}.` };
  const lock = LockSpecSchema.safeParse(input.lock);
  if (!lock.success) return { ok: false, error: "The lock settings are not valid." };
  const map = FieldMapSchema.safeParse(input.field_map ?? {});
  if (!map.success) return { ok: false, error: "The field mapping is not valid." };
  const valid = new Set(lockableFields(doc.data).map((f) => f.key));
  for (const k of lock.data.editable) if (!valid.has(k)) return { ok: false, error: `"${k}" cannot be unlocked: that field does not exist or is never editable.` };
  if (new Set(lock.data.editable).size !== lock.data.editable.length) return { ok: false, error: "The lock settings list a field twice." };
  for (const [k, source] of Object.entries(map.data)) {
    if (!valid.has(k)) return { ok: false, error: `"${k}" cannot be filled from the directory: that field does not exist.` };
    if (!isPersonSource(source)) return { ok: false, error: `"${source}" is not a directory field.` };
  }
  return { ok: true, spec: { doc: doc.data, lock: lock.data, field_map: map.data } };
}

/** A sensible starting point: name and phone from the directory; employees may change their title and phone. */
export function defaultSpec(doc: SignatureDoc): { lock: LockSpec; field_map: FieldMap } {
  const field_map: FieldMap = {};
  const editable: string[] = [];
  const firstOf = (type: string) => doc.blocks.findIndex((b) => b.type === type);
  const id = firstOf("identity");
  if (id >= 0) {
    field_map[fieldKey(id, "name")] = "full_name";
    field_map[fieldKey(id, "title")] = "title";
    editable.push(fieldKey(id, "title"));
  }
  const c = firstOf("contact");
  if (c >= 0) {
    field_map[fieldKey(c, "phone")] = "phone";
    field_map[fieldKey(c, "email")] = "email";
    editable.push(fieldKey(c, "phone"));
  }
  return { lock: { editable }, field_map };
}
