import { z } from "zod";
import { MAX_CSV_BYTES, MAX_CSV_COLUMNS, MAX_CSV_ROWS, parseCsv, unguardCell } from "./csv";

/** People fields an import can fill, with the label shown in the mapping screen. */
export const PERSON_FIELDS = {
  email: "Email",
  full_name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  title: "Job title",
  department: "Department",
  phone: "Phone",
  mobile: "Mobile",
  location: "Location",
  status: "Status (active or inactive)",
  external_id: "External id",
} as const;
export type PersonField = keyof typeof PERSON_FIELDS;

export const MAX_CUSTOM_FIELDS = 10;
export const SOURCES = ["manual", "csv", "google", "microsoft", "crm"] as const;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CUSTOM_KEY = /^[a-z][a-z0-9_]{0,29}$/;

const text = (max: number) => z.string().trim().max(max);

export const CustomFields = z
  .record(z.string().regex(CUSTOM_KEY, "Custom field names use lower-case letters, digits and underscores."), z.string().trim().max(200))
  .refine((o) => Object.keys(o).length <= MAX_CUSTOM_FIELDS, `At most ${MAX_CUSTOM_FIELDS} custom fields.`);

/** One person as the API and the database accept it. */
export const PersonInput = z.object({
  email: z.string().trim().toLowerCase().max(254).regex(EMAIL_RE, "Enter a valid email address."),
  full_name: text(120).default(""),
  first_name: text(60).default(""),
  last_name: text(60).default(""),
  title: text(100).default(""),
  department: text(80).default(""),
  phone: text(40).default(""),
  mobile: text(40).default(""),
  location: text(120).default(""),
  status: z.enum(["active", "inactive"]).default("active"),
  external_id: text(200).optional(),
  custom: CustomFields.default({}),
});
export type PersonInputT = z.infer<typeof PersonInput>;

/** Same, but the name is required (given directly or built from first + last). */
export function normalizePerson(raw: z.input<typeof PersonInput>): { ok: true; person: PersonInputT } | { ok: false; field: string; message: string } {
  const r = PersonInput.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, field: String(issue.path[0] ?? ""), message: issue.message };
  }
  const p = r.data;
  if (!p.full_name) p.full_name = `${p.first_name} ${p.last_name}`.trim();
  if (!p.full_name) return { ok: false, field: "full_name", message: "A name is required (full name, or first and last name)." };
  if (p.full_name.length > 120) return { ok: false, field: "full_name", message: "The name is longer than 120 characters." };
  return { ok: true, person: p };
}

/* ----------------------------------------------------------------- mapping */

/** Column index -> target. "" means ignore, "custom:<key>" a custom field. */
export type Mapping = Record<number, string>;
export const MappingSchema = z.record(z.string().regex(/^\d{1,3}$/), z.string().max(40)).transform((o) => {
  const m: Mapping = {};
  for (const [k, v] of Object.entries(o)) m[Number(k)] = v;
  return m;
});

const SYNONYMS: Record<PersonField, string[]> = {
  email: ["email", "e-mail", "email address", "e-mail address", "mail", "work email", "primary email", "emailaddress", "mailaddress", "userprincipalname"],
  full_name: ["name", "full name", "fullname", "display name", "displayname", "person", "employee", "employee name"],
  first_name: ["first name", "firstname", "given name", "givenname", "forename", "first"],
  last_name: ["last name", "lastname", "surname", "family name", "familyname", "last"],
  title: ["title", "job title", "jobtitle", "position", "role", "job"],
  department: ["department", "dept", "team", "division", "unit", "business unit", "group"],
  phone: ["phone", "telephone", "tel", "phone number", "work phone", "office phone", "business phone", "direct"],
  mobile: ["mobile", "mobile phone", "cell", "cell phone", "cellphone", "mobile number", "gsm"],
  location: ["location", "office", "city", "site", "address", "country", "region"],
  status: ["status", "state", "active"],
  external_id: ["external id", "externalid", "employee id", "employee number", "id", "user id", "staff id", "hris id"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "");

export const customKeyFromHeader = (h: string) => {
  const k = h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9_]+/, "").slice(0, 30);
  return k || "";
};

/** Pick a target for each header from common names. Every target is used at most once; unknown columns are left unmapped. */
export function autoMap(headers: string[]): Mapping {
  const taken = new Set<string>();
  const out: Mapping = {};
  // exact matches first, so "Name" never steals a column that is a better "First name" match
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [field, names] of Object.entries(SYNONYMS) as [PersonField, string[]][]) {
      if (!taken.has(field) && names.some((x) => norm(x) === n)) {
        out[i] = field;
        taken.add(field);
        return;
      }
    }
  });
  headers.forEach((_, i) => {
    if (out[i] === undefined) out[i] = "";
  });
  return out;
}

export function validateMapping(mapping: Mapping, columns: number): string | null {
  const used = new Set<string>();
  const customs = new Set<string>();
  for (const [col, target] of Object.entries(mapping)) {
    if (Number(col) >= columns) return `Column ${Number(col) + 1} does not exist in the file.`;
    if (!target) continue;
    if (target.startsWith("custom:")) {
      const key = target.slice(7);
      if (!CUSTOM_KEY.test(key)) return `"${key}" is not a valid custom field name (lower-case letters, digits, underscores).`;
      if (customs.has(key)) return `The custom field "${key}" is chosen for two columns.`;
      customs.add(key);
      continue;
    }
    if (!(target in PERSON_FIELDS)) return `Unknown field "${target}".`;
    if (used.has(target)) return `"${PERSON_FIELDS[target as PersonField]}" is chosen for two columns.`;
    used.add(target);
  }
  if (customs.size > MAX_CUSTOM_FIELDS) return `At most ${MAX_CUSTOM_FIELDS} custom fields.`;
  if (!used.has("email")) return "Choose which column holds the email address.";
  if (!used.has("full_name") && !(used.has("first_name") || used.has("last_name"))) return "Choose a column for the full name (or the first and last name).";
  return null;
}

/* ---------------------------------------------------------------- dry run */

export type RowError = { row: number; field: string; message: string };
export type DryRunRow = { row: number; person: PersonInputT; action: "create" | "update" };
export type DryRun = {
  fatal: string | null;
  delimiter: string;
  headers: string[];
  mapping: Mapping;
  totalRows: number;
  valid: DryRunRow[];
  errors: RowError[];
  creates: number;
  updates: number;
  /** Row numbers count the header as row 1, like a spreadsheet. */
  rowsWithErrors: number;
};

const empty = (fatal: string, extra: Partial<DryRun> = {}): DryRun => ({ fatal, delimiter: ",", headers: [], mapping: {}, totalRows: 0, valid: [], errors: [], creates: 0, updates: 0, rowsWithErrors: 0, ...extra });

/** Read just enough of a file to show the mapping screen. */
export function previewCsv(csv: string): { fatal: string | null; headers: string[]; delimiter: string; sample: string[][]; mapping: Mapping; totalRows: number } {
  const base = { headers: [] as string[], delimiter: ",", sample: [] as string[][], mapping: {} as Mapping, totalRows: 0 };
  const fatal = sizeProblem(csv);
  if (fatal) return { fatal, ...base };
  const parsed = parseCsv(csv);
  if (parsed.records.length < 2) return { fatal: parsed.records.length ? "The file has a header row but no people." : "The file is empty.", ...base };
  const headers = parsed.records[0].map((h) => h.trim());
  if (headers.length > MAX_CSV_COLUMNS) return { fatal: `The file has more than ${MAX_CSV_COLUMNS} columns.`, ...base };
  if (parsed.records.length - 1 > MAX_CSV_ROWS) return { fatal: `The file has more than ${MAX_CSV_ROWS} people. Split it into smaller files.`, ...base };
  return { fatal: parsed.unterminatedQuote ? "A quoted value is never closed. Check the file for a stray quote." : null, headers, delimiter: parsed.delimiter, sample: parsed.records.slice(1, 6), mapping: autoMap(headers), totalRows: parsed.records.length - 1 };
}

function sizeProblem(csv: string): string | null {
  if (new TextEncoder().encode(csv).length > MAX_CSV_BYTES) return "The file is larger than 2 MB.";
  return null;
}

/**
 * Validate every row without touching the database. `existing` holds the lower-cased emails already in the directory
 * (used to tell creates from updates). Rows that fail are reported and left out; the rest are ready to commit.
 */
export function dryRun(csv: string, mapping: Mapping, existing: ReadonlySet<string>): DryRun {
  const size = sizeProblem(csv);
  if (size) return empty(size);
  const parsed = parseCsv(csv);
  if (parsed.records.length < 2) return empty(parsed.records.length ? "The file has a header row but no people." : "The file is empty.");
  const headers = parsed.records[0].map((h) => h.trim());
  const base = { delimiter: parsed.delimiter, headers, mapping };
  if (headers.length > MAX_CSV_COLUMNS) return empty(`The file has more than ${MAX_CSV_COLUMNS} columns.`, base);
  const total = parsed.records.length - 1;
  if (total > MAX_CSV_ROWS) return empty(`The file has more than ${MAX_CSV_ROWS} people. Split it into smaller files.`, { ...base, totalRows: total });
  if (parsed.unterminatedQuote) return empty("A quoted value is never closed. Check the file for a stray quote.", { ...base, totalRows: total });
  const bad = validateMapping(mapping, headers.length);
  if (bad) return empty(bad, { ...base, totalRows: total });

  const valid: DryRunRow[] = [];
  const errors: RowError[] = [];
  const badRows = new Set<number>();
  const seen = new Map<string, number>();
  const fail = (row: number, field: string, message: string) => {
    errors.push({ row, field, message });
    badRows.add(row);
  };

  for (let i = 1; i < parsed.records.length; i++) {
    const row = i + 1;
    const cells = parsed.records[i];
    if (cells.length > headers.length && cells.slice(headers.length).some((c) => c.trim() !== "")) {
      fail(row, "", `This row has ${cells.length} values but the header has ${headers.length}. A comma may be missing a quote.`);
      continue;
    }
    const raw: Record<string, unknown> = {};
    const custom: Record<string, string> = {};
    for (const [colStr, target] of Object.entries(mapping)) {
      if (!target) continue;
      const value = unguardCell((cells[Number(colStr)] ?? "").trim());
      if (target.startsWith("custom:")) {
        if (value) custom[target.slice(7)] = value;
      } else if (value || target === "email") raw[target] = value;
    }
    const status = typeof raw.status === "string" ? raw.status.toLowerCase() : "";
    if (status) {
      const map: Record<string, string> = { active: "active", yes: "active", true: "active", "1": "active", inactive: "inactive", no: "inactive", false: "inactive", "0": "inactive", disabled: "inactive", suspended: "inactive" };
      if (map[status]) raw.status = map[status];
      else {
        fail(row, "status", `"${raw.status}" is not a status. Use active or inactive.`);
        continue;
      }
    }
    const result = normalizePerson({ ...(raw as object), custom } as z.input<typeof PersonInput>);
    if (!result.ok) {
      fail(row, result.field, result.message);
      continue;
    }
    const person = result.person;
    const first = seen.get(person.email);
    if (first !== undefined) {
      fail(row, "email", `Duplicate of row ${first}: ${person.email}. Only the first one is used.`);
      continue;
    }
    seen.set(person.email, row);
    valid.push({ row, person, action: existing.has(person.email) ? "update" : "create" });
  }
  const updates = valid.filter((v) => v.action === "update").length;
  return { fatal: null, ...base, totalRows: total, valid, errors, creates: valid.length - updates, updates, rowsWithErrors: badRows.size };
}

/** Body of the import_people() database call for a validated row. */
export function toDbRow(p: PersonInputT) {
  return { ...p, external_id: p.external_id ?? "" };
}
