"use client";

import { call, formatDate, Status, useAction } from "../api";
import type { SourceCard, StatusData } from "./sync-types";

const RUN_LABEL: Record<string, string> = { previewed: "Preview computed", applied: "Changes applied", blocked: "Refused by the safety rules", failed: "Failed" };

export function OverviewTab({ status, onReview, onChanged }: { status: StatusData; onReview: (id: string) => void; onChanged: () => void }) {
  const { busy, error, notice, run } = useAction();

  async function preview(s: SourceCard) {
    const r = await run(s.source, () => call<{ preview_id: string }>("POST", "/api/sync/preview", { source: s.source }), "");
    onChanged();
    if (r.ok) onReview(r.data.preview_id);
  }

  return (
    <div className="space-y-6">
      <Status error={error} notice={notice} />
      <ul className="grid gap-4 lg:grid-cols-2" aria-label="Sources">
        {status.sources.map((s) => (
          <li key={s.source} className="card flex flex-col gap-4 p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{s.label}</h2>
                <p className="text-sm text-muted">{s.kind === "directory" ? "Company directory: creates, updates and deactivates people." : "CRM: fills signature fields for people already in the directory."}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${s.configured ? "border-accent text-ink" : "border-line text-muted"}`}>{s.configured ? "Connection set up" : "Not set up"}</span>
            </div>

            {!s.configured && (
              <div className="rounded-lg border border-line p-3 text-sm" role="note">
                <p className="font-medium">What is missing</p>
                <p className="mt-1 text-muted">Add these to the server environment (your <code>.env.local</code> or your host&apos;s settings), then restart. Their values are never shown here.</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {s.missing.map((m) => (
                    <li key={m}><code className="rounded border border-line px-2 py-1 text-xs">{m}</code></li>
                  ))}
                </ul>
                <p className="mt-2 text-muted">Step-by-step: <code>docs/directory-and-crm-sync.md</code>.</p>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Unattended runs</dt>
              <dd>{s.enabled ? (s.auto_apply ? "On, applies by itself" : "On, waits for you to confirm") : "Off"}</dd>
              <dt className="text-muted">Last activity</dt>
              <dd>{s.last_run ? `${RUN_LABEL[s.last_run.status] ?? s.last_run.status}, ${formatDate(s.last_run.created_at)}` : "None yet"}</dd>
            </dl>

            {s.pending && (
              <div className="rounded-lg border border-line p-3 text-sm">
                <p className="font-medium">A preview is waiting for you</p>
                <p className="mt-1 text-muted">
                  {s.pending.stats.creates} to create, {s.pending.stats.updates} to update, {s.pending.stats.deactivates} to deactivate. Computed {formatDate(s.pending.created_at)}{s.pending.trigger === "cron" ? " by a scheduled run" : ""}.
                </p>
                <button type="button" className="btn mt-3" onClick={() => onReview(s.pending!.id)}>Review these changes</button>
              </div>
            )}

            <div className="mt-auto">
              <button type="button" className="btn btn-primary" disabled={!s.configured || busy === s.source} onClick={() => preview(s)}>
                {busy === s.source ? "Fetching and comparing…" : "Run a preview"}
              </button>
              <p className="mt-2 text-xs text-muted">A preview reads the source and shows what would change. It does not change anyone.</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
