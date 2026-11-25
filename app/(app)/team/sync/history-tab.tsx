"use client";

import { useEffect, useState } from "react";
import { SOURCE_LABEL } from "@/lib/sync/types";
import { call, formatDate, Status } from "../api";
import type { Run, StatusData } from "./sync-types";

const STATUS_LABEL: Record<string, string> = { previewed: "Preview", applied: "Applied", blocked: "Refused", failed: "Failed" };

export function HistoryTab({ status }: { status: StatusData }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    call<{ runs: Run[] }>("GET", `/api/sync/runs${source ? `?source=${source}` : ""}`).then((r) => (r.ok ? (setRuns(r.data.runs), setError("")) : setError(r.message)));
  }, [source]);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="hs-source" className="mb-1 block text-sm text-muted">Source</label>
        <select id="hs-source" className="field" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {status.sources.map((s) => (
            <option key={s.source} value={s.source}>{s.label}</option>
          ))}
        </select>
      </div>
      <Status error={error} notice="" />
      {runs && runs.length === 0 && <p className="card p-6 text-sm text-muted">Nothing has run yet.</p>}
      {runs && runs.length > 0 && (
        <ul className="space-y-3" aria-label="Sync history">
          {runs.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{SOURCE_LABEL[r.source]} <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs font-normal">{STATUS_LABEL[r.status] ?? r.status}</span></p>
                <p className="text-sm text-muted">{formatDate(r.created_at)}, {r.trigger === "cron" ? "scheduled run" : "by an admin"}</p>
              </div>
              <p className="mt-1 text-sm">{r.message}</p>
              {r.stats && typeof r.stats.creates === "number" && (
                <p className="mt-1 text-sm text-muted">
                  Found {r.stats.fetched}: {r.stats.creates} to create, {r.stats.updates} to update, {r.stats.deactivates} to deactivate, {r.stats.unchanged} unchanged, {r.stats.skipped} skipped.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
