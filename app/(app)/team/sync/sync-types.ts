import type { PlanStats, Policy, SyncSource } from "@/lib/sync/types";

export type SourceCard = {
  source: SyncSource;
  label: string;
  kind: "directory" | "crm";
  configured: boolean;
  missing: string[];
  enabled: boolean;
  auto_apply: boolean;
  pending: { id: string; trigger: string; created_at: string; expires_at: string; fetched_count: number; stats: PlanStats } | null;
  last_run: { status: string; trigger: string; created_at: string; message: string } | null;
};
export type StatusData = { sources: SourceCard[]; safety_cap_percent: number; cron_configured: boolean };

export type Entry = { kind: "create" | "update" | "deactivate"; email: string; name: string; changes: { field: string; from: string; to: string }[] };
export type PreviewData = {
  preview: { id: string; source: SyncSource; status: string; trigger: string; created_at: string; expires_at: string; fetched_count: number; stats: PlanStats; warnings: { who: string; message: string }[] };
  refusal: string | null;
  total: number;
  entries: Entry[];
};

export type SourceSettingsData = {
  source: SyncSource;
  label: string;
  enabled: boolean;
  auto_apply: boolean;
  allow_blank_overwrite: boolean;
  field_policy: Record<string, Policy>;
  config: Record<string, unknown>;
  configured: boolean;
  missing: string[];
};

export type Run = { id: string; source: SyncSource; trigger: string; status: string; created_at: string; message: string; stats: Record<string, number>; errors: { who: string; message: string }[] };
