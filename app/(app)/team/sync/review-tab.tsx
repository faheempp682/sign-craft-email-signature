"use client";

import { useCallback, useEffect, useState } from "react";
import { FIELD_LABEL, SOURCE_LABEL } from "@/lib/sync/types";
import { call, Field, formatDate, Status, useAction } from "../api";
import type { Entry, PreviewData, StatusData } from "./sync-types";
import { Select } from "@/components/ui/select";

const PAGE = 25;
const KIND_LABEL = { create: "Create", update: "Update", deactivate: "Deactivate" } as const;
const label = (f: string) => FIELD_LABEL[f] ?? (f.startsWith("custom.") ? `Custom: ${f.slice(7)}` : f);

export function ReviewTab({ status, previewId, onPick, onChanged }: { status: StatusData; previewId: string | null; onPick: (id: string | null) => void; onChanged: () => void }) {
  const pending = status.sources.filter((s) => s.pending);
  const id = previewId ?? pending[0]?.pending?.id ?? null;

  if (!id) {
    return <p className="card p-6 text-sm text-muted">No preview to review. Run a preview from the Sources tab.</p>;
  }
  return (
    <div className="space-y-6">
      {pending.length > 1 && (
        <Field id="pv-pick" label="Preview">
          <Select id="pv-pick" className="field w-full sm:w-auto" value={id} onChange={(e) => onPick(e.target.value)}>
            {pending.map((s) => (
              <option key={s.pending!.id} value={s.pending!.id}>{SOURCE_LABEL[s.source]}, {formatDate(s.pending!.created_at)}</option>
            ))}
          </Select>
        </Field>
      )}
      <Review key={id} id={id} onChanged={onChanged} />
    </div>
  );
}

function Review({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [field, setField] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<PreviewData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const { busy, error, notice, run } = useAction();

  const load = useCallback(async () => {
    const p = new URLSearchParams({ kind, q, field, offset: String(offset), limit: String(PAGE) });
    const r = await call<PreviewData>("GET", `/api/sync/previews/${id}?${p}`);
    if (r.ok) {
      setData(r.data);
      setLoadError("");
    } else setLoadError(r.message);
  }, [id, kind, q, field, offset]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function apply() {
    const r = await run("apply", () => call<{ stats: Record<string, number> }>("POST", `/api/sync/previews/${id}/apply`, { confirm: true }), "");
    setConfirming(false);
    if (r.ok) setResult(r.data.stats);
    onChanged();
    load();
  }

  if (!data) return <Status error={loadError} notice="" />;
  const p = data.preview;
  const pendingNow = p.status === "pending" && !result;
  const nothing = p.stats.creates + p.stats.updates + p.stats.deactivates === 0;
  const fields = [...new Set(["title", "department", "phone", "mobile", "location", "full_name", "status", "email"])];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{SOURCE_LABEL[p.source]}: changes to review</h2>
        <p className="text-sm text-muted">
          Computed {formatDate(p.created_at)}{p.trigger === "cron" ? " by a scheduled run" : ""}. Valid until {formatDate(p.expires_at)}. {p.source === "hubspot" || p.source === "generic" ? `${p.fetched_count} people found in the CRM.` : `${p.fetched_count} users read from the source.`}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["To create", p.stats.creates],
          ["To update", p.stats.updates],
          ["To deactivate", p.stats.deactivates],
          ["Unchanged", p.stats.unchanged],
          ["Skipped", p.stats.skipped],
        ].map(([k, v]) => (
          <div key={k as string} className="card p-4">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      {data.refusal && pendingNow && (
        <div role="alert" className="rounded-lg border border-red-600 p-4 text-sm text-red-700 dark:border-red-400 dark:text-red-300">
          <p className="font-medium">This cannot be applied</p>
          <p className="mt-1">{data.refusal}</p>
        </div>
      )}
      {p.status !== "pending" && !result && <p role="status" className="rounded-lg border border-line p-4 text-sm text-muted">This preview was {p.status === "applied" ? "applied" : "replaced by a newer one"} and can no longer be applied.</p>}

      {p.stats.deactivates > 0 && <p className="text-sm text-muted">People who are missing from the source are made <strong className="text-ink">inactive</strong>. Nobody is ever deleted, and you can make them active again in the People tab.</p>}

      {p.warnings.length > 0 && (
        <details className="card p-4 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">{p.warnings.length} note{p.warnings.length === 1 ? "" : "s"} about accounts that were skipped or adjusted</summary>
          <ul className="mt-2 space-y-1 text-muted">
            {p.warnings.map((w, i) => (
              <li key={i}><span className="text-ink">{w.who}</span>: {w.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field id="rv-kind" label="Show">
          <Select id="rv-kind" className="field" value={kind} onChange={(e) => { setKind(e.target.value); setOffset(0); }}>
            <option value="all">All changes</option>
            <option value="create">To create</option>
            <option value="update">To update</option>
            <option value="deactivate">To deactivate</option>
          </Select>
        </Field>
        <Field id="rv-field" label="Changed field">
          <Select id="rv-field" className="field" value={field} onChange={(e) => { setField(e.target.value); setOffset(0); }}>
            <option value="">Any field</option>
            {fields.map((f) => (
              <option key={f} value={f}>{label(f)}</option>
            ))}
          </Select>
        </Field>
        <Field id="rv-q" label="Search name or email">
          <input id="rv-q" className="field w-full sm:w-64" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </Field>
      </div>

      {data.entries.length === 0 ? (
        <p className="card p-6 text-sm text-muted">{nothing ? "Nothing would change: the directory already matches the source." : "No change matches those filters."}</p>
      ) : (
        <>
          <ul className="space-y-3 md:hidden" aria-label="Changes">
            {data.entries.map((e, i) => (
              <li key={`${e.email}-${i}`} className="card space-y-2 p-4">
                <Who e={e} />
                <Changes e={e} />
              </li>
            ))}
          </ul>
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Changes this run would make</caption>
              <thead className="text-left text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="p-3 font-medium">Person</th>
                  <th scope="col" className="p-3 font-medium">Action</th>
                  <th scope="col" className="p-3 font-medium">What changes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.entries.map((e, i) => (
                  <tr key={`${e.email}-${i}`} className="align-top">
                    <td className="p-3"><div className="font-medium">{e.name}</div><div className="text-muted">{e.email}</div></td>
                    <td className="p-3 whitespace-nowrap">{KIND_LABEL[e.kind]}</td>
                    <td className="p-3"><Changes e={e} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="flex items-center justify-between text-sm text-muted" aria-label="Pages">
            <span>{offset + 1} to {Math.min(offset + PAGE, data.total)} of {data.total}</span>
            <span className="flex gap-2">
              <button type="button" className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <button type="button" className="btn" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </span>
          </nav>
        </>
      )}

      <Status error={error || loadError} notice={notice} />

      {result && (
        <p role="status" className="rounded-lg border border-accent p-4 text-sm">
          Applied: {result.applied_created ?? 0} created, {result.applied_updated ?? 0} updated, {result.applied_deactivated ?? 0} deactivated{result.applied_skipped ? `, ${result.applied_skipped} skipped because they changed in the meantime` : ""}. It is in the History tab.
        </p>
      )}

      {pendingNow && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
          {!confirming ? (
            <button type="button" className="btn btn-primary" disabled={!!data.refusal || nothing} onClick={() => setConfirming(true)}>Apply these changes</button>
          ) : (
            <>
              <p className="text-sm" id="confirm-q">Apply {p.stats.creates + p.stats.updates + p.stats.deactivates} changes to the directory now?</p>
              <button type="button" className="btn btn-primary" aria-describedby="confirm-q" disabled={busy === "apply"} onClick={apply}>{busy === "apply" ? "Applying…" : "Yes, apply"}</button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Who({ e }: { e: Entry }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0"><div className="font-medium">{e.name}</div><div className="truncate text-sm text-muted">{e.email}</div></div>
      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs">{KIND_LABEL[e.kind]}</span>
    </div>
  );
}

function Changes({ e }: { e: Entry }) {
  if (e.kind === "deactivate") return <p className="text-sm text-muted">Missing from the source: becomes inactive.</p>;
  if (e.changes.length === 0) return <p className="text-sm text-muted">New person.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {e.changes.map((c) => (
        <li key={c.field}>
          <span className="text-muted">{label(c.field)}: </span>
          {c.from ? <del className="text-muted">{c.from}</del> : <span className="text-muted">(empty)</span>}
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> becomes </span>
          {c.to ? <strong className="font-medium">{c.to}</strong> : <strong className="font-medium">(erased)</strong>}
        </li>
      ))}
    </ul>
  );
}
