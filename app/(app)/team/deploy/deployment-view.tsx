"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { call, formatDate, Status, useAction } from "../api";
import { Pill } from "./ui";

export type Deployment = { id: string; target: string; kind: "deploy" | "rollback" | "script"; rollback_of: string | null; status: string; note: string; total: number; done: number; failed: number; skipped: number; pending: number; created_at: string; finished_at: string | null; cancelled_at: string | null };
type Item = { id: string; email: string; person_name: string; action: string; status: string; error_code: string; error: string; attempts: number; previous_known: boolean; previous_truncated: boolean };
type Run = { batch: { throttled: boolean; setupProblem: boolean }; deployment: Deployment; retryAfterMs: number };

export const STATUS_LABEL: Record<string, string> = { running: "Running", succeeded: "Finished", partial: "Finished with errors", failed: "Failed", cancelled: "Cancelled", generated: "Generated" };
const ITEM_LABEL: Record<string, string> = { pending: "Waiting", running: "Working", done: "Done", failed: "Failed", skipped: "Not changed" };
const tone = (s: string) => (s === "done" || s === "succeeded" ? "good" : s === "failed" ? "bad" : s === "partial" || s === "skipped" ? "warn" : "plain");
const FILTERS = ["", "failed", "skipped", "done", "pending"] as const;
const FILTER_LABEL: Record<string, string> = { "": "All", failed: "Failed", skipped: "Not changed", done: "Done", pending: "Waiting" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One deployment: progress while it runs (this screen drives the queue, a batch at a time, and can be closed and
 * reopened without losing anything), the per-person results, retry, cancel and rollback.
 */
export function DeploymentView({ id, onOpen, onBack }: { id: string; onOpen: (id: string) => void; onBack: () => void }) {
  const [dep, setDep] = useState<Deployment | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("");
  const [page, setPage] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [paused, setPaused] = useState(false);
  const [problem, setProblem] = useState("");
  const [slow, setSlow] = useState(false);
  const [rollback, setRollback] = useState<null | { restorable: number; unrestorable: number }>(null);
  const [agreed, setAgreed] = useState(false);
  const { busy, error, notice, run } = useAction();
  const driving = useRef(false);
  const alive = useRef(true);

  const load = useCallback(
    async (p = page, f = filter) => {
      const r = await call<{ deployment: Deployment; items: Item[]; total: number }>("GET", `/api/deploy/deployments/${id}?page=${p}${f ? `&status=${f}` : ""}`);
      if (!alive.current) return null;
      if (!r.ok) {
        setLoadError(r.message);
        return null;
      }
      setLoadError("");
      setDep(r.data.deployment);
      setItems((prev) => (p === 0 ? r.data.items : [...prev, ...r.data.items]));
      setTotal(r.data.total);
      return r.data.deployment;
    },
    [id, page, filter],
  );

  useEffect(() => {
    alive.current = true;
    load(page, filter);
    return () => {
      alive.current = false;
    };
  }, [load, page, filter]);

  // Drive the queue while the deployment is running and this screen is open.
  useEffect(() => {
    if (!dep || dep.status !== "running" || paused || driving.current) return;
    driving.current = true;
    (async () => {
      while (alive.current) {
        const r = await call<Run>("POST", `/api/deploy/deployments/${id}/run`);
        if (!alive.current) break;
        if (!r.ok) {
          setProblem(r.message);
          setPaused(true);
          break;
        }
        setDep(r.data.deployment);
        setSlow(r.data.batch.throttled);
        if (r.data.batch.setupProblem) {
          setProblem("Google refused. The service account is not authorised for this scope in the Admin console. Fix that, then press Resume.");
          setPaused(true);
          break;
        }
        if (r.data.deployment.status !== "running") break;
        if (r.data.retryAfterMs) await sleep(r.data.retryAfterMs);
      }
      driving.current = false;
      if (alive.current) {
        setSlow(false);
        setPage(0);
        load(0, filter);
      }
    })();
  }, [dep, paused, id, load, filter]);

  async function retry() {
    const r = await run("retry", () => call<{ requeued: number }>("POST", `/api/deploy/deployments/${id}/retry`), "");
    if (r.ok) {
      setPaused(false);
      setProblem("");
      load(0, filter);
    }
  }
  async function cancel() {
    const r = await run("cancel", () => call("POST", `/api/deploy/deployments/${id}/cancel`), "Cancelled. People not reached yet were left unchanged.");
    if (r.ok) load(0, filter);
  }
  async function prepareRollback() {
    // count what can really be restored: done items with a complete saved copy
    let restorable = 0;
    let unrestorable = 0;
    for (let p = 0; p < 25; p++) {
      const r = await call<{ items: Item[]; total: number }>("GET", `/api/deploy/deployments/${id}?status=done&page=${p}`);
      if (!r.ok) return setProblem(r.message);
      for (const i of r.data.items) {
        if (i.previous_known && !i.previous_truncated && i.action !== "skip") restorable++;
        else unrestorable++;
      }
      if ((p + 1) * 100 >= r.data.total) break;
    }
    setAgreed(false);
    setRollback({ restorable, unrestorable });
  }
  async function confirmRollback() {
    if (!rollback) return;
    const r = await run("rollback", () => call<{ id: string }>("POST", `/api/deploy/deployments/${id}/rollback`, { expected: rollback.restorable, confirmed: true }));
    if (r.ok) onOpen(r.data.id);
    else setRollback(null);
  }

  if (loadError) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!dep) return <p className="text-sm text-muted">Loading…</p>;

  const finished = dep.total - dep.pending;
  const pct = dep.total ? Math.round((finished / dep.total) * 100) : 100;
  const canRetry = (dep.status === "partial" || dep.status === "failed") && dep.failed > 0;
  const canRollback = dep.kind === "deploy" && dep.status !== "running" && dep.done > 0;

  return (
    <div className="space-y-6">
      <button type="button" className="btn" onClick={onBack}>Back to history</button>
      <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="dv-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="dv-h" className="text-lg font-semibold">{dep.kind === "rollback" ? "Rollback" : "Deployment"} to Gmail</h2>
            <p className="text-sm text-muted">Started {formatDate(dep.created_at)}{dep.finished_at ? ` · finished ${formatDate(dep.finished_at)}` : ""}</p>
            {dep.kind === "rollback" && dep.rollback_of && <p className="text-sm"><button type="button" className="min-h-11 underline" onClick={() => onOpen(dep.rollback_of!)}>See the deployment this restores</button></p>}
          </div>
          <Pill tone={dep.status === "succeeded" ? "good" : dep.status === "failed" ? "bad" : dep.status === "partial" ? "warn" : "plain"}>{STATUS_LABEL[dep.status] ?? dep.status}</Pill>
        </div>

        <div>
          <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={dep.total} aria-valuenow={finished} className="h-3 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm" aria-live="polite">
            {finished.toLocaleString("en-GB")} of {dep.total.toLocaleString("en-GB")} handled · {dep.done.toLocaleString("en-GB")} done · {dep.failed.toLocaleString("en-GB")} failed · {dep.skipped.toLocaleString("en-GB")} not changed
            {slow ? " · Google is limiting requests, slowing down" : ""}
          </p>
        </div>

        {problem && <p role="alert" className="rounded-lg border border-red-600 p-3 text-sm dark:border-red-400">{problem}</p>}
        <Status error={error} notice={notice} />
        <div className="flex flex-wrap gap-3">
          {dep.status === "running" && paused && <button type="button" className="btn btn-primary" onClick={() => { setProblem(""); setPaused(false); }}>Resume</button>}
          {dep.status === "running" && <button type="button" className="btn" disabled={busy !== null} onClick={cancel}>Cancel the rest</button>}
          {canRetry && <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={retry}>Retry the {dep.failed} that failed</button>}
          {canRollback && !rollback && <button type="button" className="btn" onClick={prepareRollback}>Roll back…</button>}
        </div>
        {dep.status === "running" && !paused && <p className="text-sm text-muted">Keep this page open while it runs. If you close it, come back to History and press Resume: nothing is lost and finished people are never written twice.</p>}

        {rollback && (
          <div className="space-y-3 rounded-xl border border-line p-4" role="group" aria-label="Confirm rollback">
            <h3 className="font-semibold">Restore the previous signatures</h3>
            {rollback.restorable === 0 ? (
              <p className="text-sm text-muted">Nothing can be restored: no saved copies exist for this deployment.</p>
            ) : (
              <>
                <p className="text-sm">
                  This puts back the signature each of <strong>{rollback.restorable.toLocaleString("en-GB")}</strong> people had before the deployment (an empty signature is restored as empty).
                  {rollback.unrestorable > 0 ? ` ${rollback.unrestorable} cannot be restored because no complete copy was saved.` : ""} Anyone who has changed their signature since is left alone.
                </p>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 size-5 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>Yes, restore these signatures.</span>
                </label>
                <button type="button" className="btn btn-primary" disabled={!agreed || busy !== null} onClick={confirmRollback}>{busy === "rollback" ? "Starting…" : `Restore ${rollback.restorable.toLocaleString("en-GB")} ${rollback.restorable === 1 ? "signature" : "signatures"}`}</button>
              </>
            )}
            <button type="button" className="btn ml-2" onClick={() => setRollback(null)}>Not now</button>
          </div>
        )}
      </section>

      <section aria-labelledby="res-h" className="space-y-3">
        <h3 id="res-h" className="text-lg font-semibold">Results</h3>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f || "all"} type="button" aria-pressed={filter === f} className={`btn ${filter === f ? "btn-primary" : ""}`} onClick={() => { setFilter(f); setPage(0); }}>{FILTER_LABEL[f]}</button>
          ))}
        </div>
        <ul className="divide-y divide-line rounded-2xl border border-line text-sm" aria-label="People">
          {items.map((i) => (
            <li key={i.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="break-words font-medium">{i.person_name || i.email}</p>
                <p className="break-all text-muted">{i.email}</p>
                {i.error && <p className="mt-1 text-muted">{i.error}</p>}
              </div>
              <div className="shrink-0"><Pill tone={tone(i.status)}>{ITEM_LABEL[i.status] ?? i.status}</Pill></div>
            </li>
          ))}
          {items.length === 0 && <li className="p-3 text-muted">Nobody in this view.</li>}
        </ul>
        {items.length < total && <button type="button" className="btn" onClick={() => setPage((p) => p + 1)}>Show more ({total - items.length} left)</button>}
      </section>
    </div>
  );
}
