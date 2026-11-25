export type HealthRun = {
  id: string;
  trigger: "manual" | "cron";
  status: "running" | "completed" | "failed" | "abandoned";
  checked: number;
  ok: number;
  edited: number;
  removed: number;
  unreachable: number;
  reformatted: number;
  new_findings: number;
  resolved: number;
  capped: boolean;
  note: string;
  started_at: string;
  finished_at: string | null;
};

export type HealthStatus = {
  setup: { configured: boolean; missing: string[]; unattended_ready: boolean; unattended_missing: string[] };
  settings: { enabled: boolean; has_webhook: boolean; webhook_masked: string | null; include_names: boolean; max_people: number };
  runs: HealthRun[];
  counts: { open: number; acknowledged: number; monitored: number; ok: number; unreachable: number };
};

export type Finding = {
  id: string;
  person_id: string;
  email: string;
  person_name: string;
  kind: "edited" | "removed";
  status: "open" | "acknowledged" | "resolved";
  detail: string;
  opened_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  resolved_reason: string;
  acknowledged_at: string | null;
  ack_note: string;
};

export type FindingsPage = { items: Finding[]; total: number; page: number; page_size: number };

export const KIND_LABEL: Record<Finding["kind"], string> = { edited: "Edited", removed: "Removed" };
export const STATUS_LABEL: Record<Finding["status"], string> = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved" };
export const RESOLVED_LABEL: Record<string, string> = { live_matches: "The signature matches again", not_monitored: "No longer monitored" };
