"use client";

import Link from "next/link";
import { useState } from "react";
import { call, Status, useAction } from "../api";
import { confirmLabel } from "../deploy/gmail-tab";
import { Pill } from "../deploy/ui";
import type { Finding } from "./types";

type PlanItem = { person_id: string; email: string; name: string; action: "set" | "replace" | "skip"; code: string; reason: string };
type Plan = { items: PlanItem[]; counts: { total: number; set: number; replace: number; skipped: number; already_current: number; actionable: number }; fingerprint: string; blockers: string[] };
type Dep = { deployment: { id: string; status: string; done: number; failed: number; skipped: number; pending: number; total: number }; retryAfterMs?: number | null; batch: { setupProblem?: boolean } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Restore = the EXISTING deploy flow, unchanged: plan (a dry run that reads Gmail), explicit confirmation of exact numbers,
 * then the deployment queue, which keeps a backup of every signature it replaces and can be rolled back from Deploy, History.
 * This panel adds nothing of its own: it calls the same /api/deploy routes with the people you picked.
 */
export function RestorePanel({ people, onClose, onDone }: { people: Finding[]; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [progress, setProgress] = useState("");
  const [depId, setDepId] = useState<string | null>(null);
  const [finished, setFinished] = useState("");
  const { busy, error, notice, run, setError } = useAction();
  const ids = people.map((p) => p.person_id);

  async function makePlan() {
    setAgreed(false);
    const r = await run("plan", () => call<Plan>("POST", "/api/deploy/gmail/plan", { person_ids: ids }), "");
    setPlan(r.ok ? r.data : null);
  }

  async function confirm() {
    if (!plan) return;
    const r = await run("confirm", () => call<{ id: string }>("POST", "/api/deploy/gmail/deploy", { fingerprint: plan.fingerprint, set: plan.counts.set, replace: plan.counts.replace, person_ids: ids, confirmed: true }));
    if (!r.ok) {
      if (r.status === 409) setPlan(null); // stale: a new plan is needed
      return;
    }
    setDepId(r.data.id);
    for (let i = 0; i < 200; i++) {
      const d = await call<Dep>("POST", `/api/deploy/deployments/${r.data.id}/run`);
      if (!d.ok) {
        setError(`${d.message} You can continue it from Deploy, History.`);
        return;
      }
      const x = d.data.deployment;
      setProgress(`${x.done} done, ${x.failed} failed, ${x.skipped} not changed, ${x.pending} waiting`);
      if (d.data.batch.setupProblem) return setError("Google refused. The service account is not authorised for this scope. Fix that in the Admin console, then continue from Deploy, History.");
      if (x.status !== "running") {
        setFinished(`Finished: ${x.done} restored, ${x.failed} failed, ${x.skipped} not changed (someone may have changed it again, in which case it was left alone).`);
        return;
      }
      if (d.data.retryAfterMs) await sleep(d.data.retryAfterMs);
    }
    setError("Still running. Continue it from Deploy, History.");
  }

  const visible = plan ? plan.items.slice(0, 20) : [];
  const started = depId !== null;

  return (
    <section className="card max-w-3xl space-y-4 p-4 sm:p-6" aria-labelledby="rs-h">
      <h3 id="rs-h" className="text-lg font-semibold">Restore the approved signature for {people.length === 1 ? (people[0].person_name || people[0].email) : `${people.length.toLocaleString("en-GB")} people`}</h3>
      <p className="text-sm text-muted">
        This uses the same steps as a normal deployment. First SignCraft makes a plan by reading each person&apos;s current Gmail signature. <strong className="text-ink">Nothing is written until you confirm.</strong> Whatever they have now is saved as a backup before it is replaced, and the deployment can be rolled back from Deploy, History.
      </p>

      {!plan && !started && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary min-h-11" disabled={busy !== null} onClick={makePlan}>{busy === "plan" ? "Reading Gmail…" : "Make a plan"}</button>
          <button type="button" className="btn min-h-11" onClick={onClose}>Cancel</button>
        </div>
      )}

      {plan && !started && (
        <div className="space-y-4">
          {plan.blockers.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-600 p-3 text-sm dark:border-red-400">
              <p className="font-semibold">This cannot start</p>
              {plan.blockers.map((b) => <p key={b}>{b}</p>)}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Plan summary">
            {[["Will be set", plan.counts.set], ["Will replace", plan.counts.replace], ["Already up to date", plan.counts.already_current], ["Skipped", plan.counts.skipped]].map(([k, v]) => (
              <div key={k as string} className="rounded-lg border border-line p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-xl font-semibold tabular-nums">{(v as number).toLocaleString("en-GB")}</dd>
              </div>
            ))}
          </dl>
          <ul className="divide-y divide-line text-sm" aria-label="People in this plan">
            {visible.map((i) => (
              <li key={i.person_id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="break-words font-medium">{i.name || i.email}</p>
                  <p className="text-muted">{i.reason}</p>
                </div>
                <Pill tone={i.action === "skip" ? "plain" : "good"}>{i.action === "set" ? "Will be set" : i.action === "replace" ? "Will replace" : i.code === "already_current" ? "Already current" : "Skipped"}</Pill>
              </li>
            ))}
          </ul>
          {plan.items.length > visible.length && <p className="text-sm text-muted">…and {plan.items.length - visible.length} more.</p>}
          {plan.counts.actionable > 0 && plan.blockers.length === 0 ? (
            <>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-5 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>I have reviewed this plan and want SignCraft to write these signatures into Gmail.</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary min-h-11" disabled={!agreed || busy !== null} onClick={confirm}>{busy === "confirm" ? "Starting…" : confirmLabel(plan.counts)}</button>
                <button type="button" className="btn min-h-11" onClick={onClose}>Cancel</button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted">{plan.counts.actionable === 0 ? "There is nothing to restore: everyone in this plan is skipped or already has the approved signature." : ""}</p>
              <button type="button" className="btn min-h-11" onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      )}

      {started && (
        <div className="space-y-3" aria-live="polite">
          <p className="text-sm">{finished || `Restoring… ${progress}`}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/team/deploy" className="btn min-h-11">Open Deploy, History</Link>
            <button type="button" className="btn btn-primary min-h-11" disabled={!finished} onClick={onDone}>Done</button>
          </div>
          <p className="text-sm text-muted">The finding closes by itself at the next check, once the signature in Gmail matches again.</p>
        </div>
      )}
      <Status error={error} notice={notice} />
    </section>
  );
}
