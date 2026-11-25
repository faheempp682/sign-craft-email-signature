"use client";

import { useEffect, useMemo, useState } from "react";
import { call, Field, Status, useAction } from "../api";
import { Pill, SetupCard } from "./ui";

export type DeployStatusInfo = { configured: boolean; serviceAccountEmail: string | null; clientId: string | null; scope: string; steps: string[] };

type PlanItem = { person_id: string; email: string; name: string; action: "set" | "replace" | "skip"; code: string; reason: string; has_existing: boolean };
type Plan = {
  items: PlanItem[];
  counts: { total: number; set: number; replace: number; skipped: number; already_current: number; actionable: number };
  fingerprint: string;
  blockers: string[];
  notHonoured: { id: string; name: string; reasons: string[] }[];
  rulesApplied: boolean;
};

const PAGE = 50;
const FILTERS = [
  { id: "all", label: "Everyone" },
  { id: "set", label: "Will be set" },
  { id: "replace", label: "Will replace" },
  { id: "current", label: "Already up to date" },
  { id: "skip", label: "Skipped" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

const kindOf = (i: PlanItem): FilterId => (i.action === "set" ? "set" : i.action === "replace" ? "replace" : i.code === "already_current" ? "current" : "skip");
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** The exact sentence on the confirm button. */
export const confirmLabel = (c: { set: number; replace: number; actionable: number }) =>
  `Deploy to ${plural(c.actionable, "person", "people")}${c.replace ? `, replacing ${plural(c.replace, "existing signature", "existing signatures")}` : ""}`;

export function GmailTab({ onStarted }: { onStarted: (id: string) => void }) {
  const [status, setStatus] = useState<DeployStatusInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [department, setDepartment] = useState("");
  const [plan, setPlan] = useState<(Plan & { department: string }) | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");
  const [shown, setShown] = useState(PAGE);
  const [agreed, setAgreed] = useState(false);
  const { busy, error, notice, run } = useAction();

  useEffect(() => {
    call<DeployStatusInfo>("GET", "/api/deploy/status").then((r) => (r.ok ? setStatus(r.data) : setLoadError(r.message)));
  }, []);

  async function makePlan() {
    setAgreed(false);
    setFilter("all");
    setShown(PAGE);
    const dep = department.trim();
    const r = await run("plan", () => call<Plan>("POST", "/api/deploy/gmail/plan", dep ? { department: dep } : {}), "");
    if (r.ok) setPlan({ ...r.data, department: dep });
    else setPlan(null);
  }

  async function confirm() {
    if (!plan) return;
    const r = await run("confirm", () => call<{ id: string }>("POST", "/api/deploy/gmail/deploy", { fingerprint: plan.fingerprint, set: plan.counts.set, replace: plan.counts.replace, department: plan.department || undefined, confirmed: true }));
    if (r.ok) onStarted(r.data.id);
    else if (r.status === 409) setPlan(null); // stale: the old plan must not be reused
  }

  const visible = useMemo(() => (plan ? plan.items.filter((i) => filter === "all" || kindOf(i) === filter) : []), [plan, filter]);

  if (loadError) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!status) return <p className="text-sm text-muted">Loading…</p>;
  if (!status.configured) return <SetupCard steps={status.steps} scope={status.scope} />;

  return (
    <div className="space-y-8">
      <section className="card max-w-3xl space-y-4 p-4 sm:p-6" aria-labelledby="g-h">
        <h2 id="g-h" className="text-lg font-semibold">1. Plan</h2>
        <p className="text-sm text-muted">
          A plan is a dry run. SignCraft reads each person&apos;s current Gmail signature and shows what would happen. <strong className="text-ink">Nothing is written until you confirm.</strong> Only each person&apos;s approved signature is ever deployed, and only to their primary Gmail address.
        </p>
        <div className="max-w-sm">
          <Field id="g-dept" label="Only this department (leave empty for everyone)" hint="Exact department name from the directory.">
            <input id="g-dept" className="field w-full" value={department} maxLength={80} onChange={(e) => setDepartment(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={makePlan}>{busy === "plan" ? "Reading Gmail…" : plan ? "Plan again" : "Make a plan"}</button>
          <span className="text-xs text-muted">Built, not yet verified against a real Workspace.</span>
        </div>
        <Status error={error} notice={notice} />
      </section>

      {plan && (
        <section aria-labelledby="p-h" className="space-y-5">
          <h2 id="p-h" className="text-lg font-semibold">2. Review</h2>
          {plan.blockers.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-600 p-3 text-sm dark:border-red-400">
              <p className="font-semibold">Deployment cannot start</p>
              {plan.blockers.map((b) => <p key={b}>{b}</p>)}
            </div>
          )}
          {plan.notHonoured.length > 0 && (
            <div role="note" className="rounded-lg border border-line p-3 text-sm">
              <p className="font-semibold">Some rules cannot apply to Gmail</p>
              <p className="text-muted">Gmail keeps one signature per address, so it cannot follow rules about new messages, replies or internal and external recipients. It follows department rules and uses the default for everyone else. Not applied here: {plan.notHonoured.map((r) => `${r.name} (${r.reasons.join(", ")})`).join("; ")}.</p>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Plan summary">
            {[
              ["Will be set", plan.counts.set],
              ["Will replace", plan.counts.replace],
              ["Already up to date", plan.counts.already_current],
              ["Skipped", plan.counts.skipped],
              ["In this plan", plan.counts.total],
            ].map(([k, v]) => (
              <div key={k as string} className="card p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{(v as number).toLocaleString("en-GB")}</dd>
              </div>
            ))}
          </dl>

          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setShown(PAGE); }} className={`btn ${filter === f.id ? "btn-primary" : ""}`}>{f.label}</button>
            ))}
          </div>
          <ul className="divide-y divide-line rounded-2xl border border-line text-sm" aria-label="People in the plan">
            {visible.slice(0, shown).map((i) => (
              <li key={i.person_id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="break-words font-medium">{i.name}</p>
                  <p className="break-all text-muted">{i.email}</p>
                  <p className="mt-1 text-muted">{i.reason}</p>
                </div>
                <div className="shrink-0">
                  {i.action === "set" && <Pill tone="good">Will be set</Pill>}
                  {i.action === "replace" && <Pill tone="warn">Will replace existing</Pill>}
                  {i.action === "skip" && <Pill>{i.code === "already_current" ? "Already up to date" : "Skipped"}</Pill>}
                </div>
              </li>
            ))}
            {visible.length === 0 && <li className="p-3 text-muted">Nobody in this view.</li>}
          </ul>
          {visible.length > shown && <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>Show more ({visible.length - shown} left)</button>}

          <div className="card max-w-3xl space-y-4 p-4 sm:p-6">
            <h2 className="text-lg font-semibold">3. Confirm</h2>
            {plan.counts.actionable === 0 ? (
              <p className="text-sm text-muted">There is nothing to deploy: everyone is skipped or already up to date.</p>
            ) : (
              <>
                <p className="text-sm">
                  This writes the signatures marked <em>Will be set</em> or <em>Will replace</em>. Before each write, the signature Gmail has now is saved, so you can <strong>roll the whole deployment back</strong>. People marked Skipped or Already up to date are not touched. If anything changes before you confirm (an approval, the directory, or someone editing their own signature), the plan is refused and you review it again.
                </p>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 size-5 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={plan.blockers.length > 0} />
                  <span>I have read the plan above and want it written to these Gmail accounts.</span>
                </label>
                <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={!agreed || busy !== null || plan.blockers.length > 0} onClick={confirm}>
                  {busy === "confirm" ? "Starting…" : confirmLabel(plan.counts)}
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
