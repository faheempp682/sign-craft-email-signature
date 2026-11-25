/** Shared types and constants for directory sync (Google, Microsoft) and CRM sync (HubSpot, generic REST). */

export const DIRECTORY_SOURCES = ["google", "microsoft"] as const;
export const CRM_SOURCES = ["hubspot", "generic"] as const;
export const SYNC_SOURCES = [...DIRECTORY_SOURCES, ...CRM_SOURCES] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];
export type DirectorySource = (typeof DIRECTORY_SOURCES)[number];
export type CrmSource = (typeof CRM_SOURCES)[number];

export const isDirectory = (s: SyncSource): s is DirectorySource => (DIRECTORY_SOURCES as readonly string[]).includes(s);
export const isCrm = (s: SyncSource): s is CrmSource => (CRM_SOURCES as readonly string[]).includes(s);

export const SOURCE_LABEL: Record<SyncSource, string> = {
  google: "Google Workspace",
  microsoft: "Microsoft 365",
  hubspot: "HubSpot",
  generic: "Kimp CRM (generic REST)",
};

/** The feature flag that gates each source. */
export const SOURCE_FEATURE = { google: "directory_sync", microsoft: "directory_sync", hubspot: "crm_sync", generic: "crm_sync" } as const;

/** Most users one directory run handles (matches the 5,000 people import_people accepts). A larger directory is refused, never truncated. */
export const MAX_DIRECTORY_USERS = 5000;

/** Text columns of a person, with the longest value the database accepts (migration 0009). */
export const FIELD_MAX = { full_name: 120, first_name: 60, last_name: 60, title: 100, department: 80, phone: 40, mobile: 40, location: 120 } as const;
export type TextField = keyof typeof FIELD_MAX;
export const TEXT_FIELDS = Object.keys(FIELD_MAX) as TextField[];
export const CUSTOM_MAX = 200;
export const MAX_CUSTOM = 10;
export const CUSTOM_KEY = /^[a-z][a-z0-9_]{0,29}$/;

export const FIELD_LABEL: Record<string, string> = {
  full_name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  title: "Job title",
  department: "Department",
  phone: "Phone",
  mobile: "Mobile",
  location: "Location",
  status: "Status",
  email: "Email",
  source: "Linked source",
  external_id: "External id",
};

/** Fields a directory can fill. `status` follows the account (suspended or disabled = inactive). */
export const DIRECTORY_FIELDS = [...TEXT_FIELDS, "status"] as const;
/** Fields a CRM can fill: the text columns and custom.<key>. Never email, status or ids. */
export const CRM_TARGETS = TEXT_FIELDS;

/** Who wins when both sides have a different non-blank value. `source`: the sync overwrites. `directory`: the sync only fills blanks. */
export type Policy = "source" | "directory";
export type FieldPolicy = Record<string, Policy>;

/** One user as the directory API describes them, after mapping. */
export type SourceUser = {
  external_id: string;
  email: string;
  full_name: string;
  first_name: string;
  last_name: string;
  title: string;
  department: string;
  phone: string;
  mobile: string;
  location: string;
  /** Account disabled or suspended in the source. */
  status: "active" | "inactive";
};

export type DirectoryFetch = {
  users: SourceUser[];
  /** Every external id the source returned, including ones skipped for lack of an email: a skipped user is NOT a missing user. */
  seenIds: Set<string>;
  /** Accounts left out (no email, guest, invalid values). They are listed in `warnings` (first 50 only). */
  skipped: number;
  warnings: SyncWarning[];
};

export type SyncWarning = { who: string; message: string };

/** A person already in the directory, as the diff needs them. */
export type ExistingPerson = {
  id: string;
  email: string;
  full_name: string;
  first_name: string;
  last_name: string;
  title: string;
  department: string;
  phone: string;
  mobile: string;
  location: string;
  custom: Record<string, string>;
  source: string;
  external_id: string | null;
  status: "active" | "inactive";
};

export type FieldChange = { field: string; from: string; to: string };

export type PlanCreate = { email: string; external_id: string; full_name: string; first_name: string; last_name: string; title: string; department: string; phone: string; mobile: string; location: string };
export type PlanUpdate = {
  person_id: string;
  email: string;
  name: string;
  /** Column values to write (only columns that change). */
  set: Record<string, string>;
  custom_set: Record<string, string>;
  custom_remove: string[];
  /** The same changes in reading order, for the diff table. */
  changes: FieldChange[];
};
export type PlanDeactivate = { person_id: string; email: string; name: string };

export type Plan = {
  creates: PlanCreate[];
  updates: PlanUpdate[];
  deactivates: PlanDeactivate[];
  unchanged: number;
  warnings: SyncWarning[];
};

export type PlanStats = {
  fetched: number;
  creates: number;
  updates: number;
  deactivates: number;
  unchanged: number;
  skipped: number;
  /** People who would lose a value (blank-overwrite) or whose custom field would be removed. */
  erasures: number;
  /** Rows in the managed set the safety cap is measured against. */
  base: number;
  not_found?: number;
};

export type SourceSettings = {
  enabled: boolean;
  auto_apply: boolean;
  allow_blank_overwrite: boolean;
  field_policy: FieldPolicy;
  config: Record<string, unknown>;
};

export const DEFAULT_SAFETY_CAP = 20;
