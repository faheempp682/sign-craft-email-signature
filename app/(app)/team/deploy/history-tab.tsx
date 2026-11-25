"use client";

import { useEffect, useState } from "react";
import { call, formatDate } from "../api";
import { STATUS_LABEL, type Deployment } from "./deployment-view";
import { Pill } from "./ui";

const KIND: Record<string, string> = { deploy: "Gmail deployment", rollback: "Gmail rollback", script: "Microsoft 365 script generated" };

export function HistoryTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Deployment[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    call<{ deployments: Deployment[] }>("GET", "/api/deploy/deployments").then((r) => (r.ok ? setRows(r.data.deployments) : setError(r.message)));
  }, []);

  if (error) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <section aria-labelledby="hist-h" className="space-y-3">
      <h2 id="hist-h" className="text-lg font-semibold">Deployments</h2>
      {rows.length === 0 && <p className="card p-6 text-sm text-muted">Nothing has been deployed yet. Make a plan on the Gmail tab.</p>}
      <ul className="divide-y divide-line rounded-2xl border border-line text-sm">
        {rows.map((d) => (
          <li key={d.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{KIND[d.kind] ?? d.kind}</p>
              <p className="text-muted">{formatDate(d.created_at)}{d.kind !== "script" ? ` · ${d.done} done, ${d.failed} failed, ${d.skipped} not changed of ${d.total}` : ""}</p>
              {d.kind === "script" && d.note && <p className="text-muted">{d.note}. Not run by SignCraft.</p>}
            </div>
            <div className="flex items-center gap-3">
              <Pill tone={d.status === "succeeded" ? "good" : d.status === "failed" ? "bad" : d.status === "partial" ? "warn" : "plain"}>{STATUS_LABEL[d.status] ?? d.status}</Pill>
              {d.kind !== "script" && <button type="button" className="btn" onClick={() => onOpen(d.id)}>{d.status === "running" ? "Resume" : "Open"}</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
