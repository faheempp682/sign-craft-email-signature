"use client";

import { useCallback, useEffect, useState } from "react";
import { call, formatDate, Status, useAction } from "../api";
import { Pill } from "../deploy/ui";
import { FindingsSection } from "./findings-section";
import { SettingsSection } from "./settings-section";
import type { HealthStatus } from "./types";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

type CheckAnswer = { run_id: string; done: boolean; checked: number; capped: boolean; failed: boolean; note: string; alert: "none" | "sent" | "failed"; alert_reason?: string };

export function HealthDashboard() {
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [progress, setProgress] = useState<string>("");
  const [version, setVersion] = useState(0);
  const [checking, setChecking] = useState(false);
  const { error, notice, setError, setNotice } = useAction();

  const load = useCallback(async () => {
    const r = await call<HealthStatus>("GET", "/api/health/status");
    if (r.ok) {
      setStatus(r.data);
      setLoadError("");
    } else setLoadError(r.message);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  /** The server checks for up to about 40 seconds per request; this keeps asking until the run says it is done. */
  async function runNow() {
    setChecking(true);
    setError("");
    setNotice("");
    setProgress("Starting…");
    let last: CheckAnswer | null = null;
    for (let i = 0; i < 100; i++) {
      const r = await call<CheckAnswer>("POST", "/api/health/check");
      if (!r.ok) {
        setProgress("");
        setError(r.message);
        setChecking(false);
        await load();
        return;
      }
      last = r.data;
      setProgress(`Checked ${plural(r.data.checked, "person", "people")} so far…`);
      if (r.data.done) break;
    }
    setProgress("");
    if (last?.failed) setError(`The check stopped: ${last.note}`);
    else if (last?.done) {
      const bits = [`Checked ${plural(last.checked, "person", "people")}.`];
      if (last.capped) bits.push("It stopped at your per-run limit; the next check continues after them.");
      if (last.alert === "sent") bits.push("The webhook alert was sent.");
      if (last.alert === "failed") bits.push(`The webhook alert could not be delivered: ${last.alert_reason ?? "unknown reason"}. The findings are listed below.`);
      setNotice(bits.join(" "));
    } else setNotice("The check is still running. Press Run check now again to continue it.");
    setChecking(false);
    await load();
    setVersion((v) => v + 1);
  }

  if (loadError) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!status) return <p className="text-sm text-muted">Loading…</p>;
  const last = status.runs[0];
  const running = checking;

  return (
    <div className="space-y-10">
      <div role="note" className="max-w-3xl rounded-lg border border-line p-4 text-sm">
        <p className="font-semibold">Built, not yet verified against a real Google Workspace.</p>
        <p className="mt-1 text-muted">
          Tested with fakes only. A report of <strong className="text-ink">edited</strong> means the words differ from what was approved (reliable). Gmail may store the same signature with different markup; that is treated as <strong className="text-ink">reformatting</strong>, not an edit, by a best guess that has not been checked against real Gmail. A change that only affects markup (a link address, a colour) is therefore not noticed. Only the primary Gmail address is checked, and only people SignCraft deployed to.
        </p>
      </div>

      {!status.setup.configured && (
        <section className="card max-w-3xl space-y-3 p-4 sm:p-6" aria-labelledby="setup-h" role="alert">
          <h2 id="setup-h" className="text-lg font-semibold">Not set up</h2>
          <p className="text-sm text-muted">Checks need the Gmail deployment setup (domain-wide delegation). On the server, set:</p>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            {status.setup.missing.map((m) => (
              <li key={m}><code>{m}</code></li>
            ))}
          </ul>
          <p className="text-sm text-muted">The steps are on the Deploy screen (Gmail tab) and in docs/deploy-and-rules.md.</p>
        </section>
      )}

      <section aria-labelledby="st-h" className="space-y-4">
        <h2 id="st-h" className="text-lg font-semibold">Status</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Health summary">
          {[
            ["Open findings", status.counts.open],
            ["Acknowledged", status.counts.acknowledged],
            ["People monitored", status.counts.monitored],
            ["Could not be read", status.counts.unreachable],
          ].map(([k, v]) => (
            <div key={k as string} className="card p-3">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{(v as number).toLocaleString("en-GB")}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted" aria-live="polite">
          {last ? (
            <>
              Last check: {formatDate(last.started_at)} ({last.trigger === "cron" ? "scheduled" : "run by an admin"}),{" "}
              {last.status === "running" ? "still running" : last.status === "completed" ? "finished" : last.status === "failed" ? "stopped" : "abandoned"}. Checked {plural(last.checked, "person", "people")}: {last.ok} fine ({last.reformatted} stored differently by Gmail), {last.edited} edited, {last.removed} removed, {last.unreachable} could not be read.
              {last.note ? ` ${last.note}` : ""}
            </>
          ) : (
            "No check has run yet."
          )}
        </p>
        <p className="text-sm text-muted">
          {status.settings.enabled ? "Scheduled checks are switched on" : "Scheduled checks are switched off"}
          {status.setup.unattended_ready ? "; the server is ready for them." : status.settings.enabled ? `; the server is missing: ${status.setup.unattended_missing.join(", ")}.` : "."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary min-h-11" disabled={running || !status.setup.configured} onClick={runNow}>
            {running ? "Checking…" : "Run check now"}
          </button>
          {progress && <span className="text-sm text-muted" aria-live="polite">{progress}</span>}
          {last?.status === "failed" && <Pill tone="bad">Last check stopped</Pill>}
        </div>
        <Status error={error} notice={notice} />
      </section>

      <FindingsSection reloadKey={version} onChanged={load} />

      <section aria-labelledby="ex-h" className="card max-w-3xl space-y-2 p-4 sm:p-6">
        <h2 id="ex-h" className="text-lg font-semibold">Microsoft 365 (Exchange) is not monitored</h2>
        <p className="text-sm text-muted">
          For Microsoft 365 SignCraft generates a mail flow (transport) rule that appends the signature to outgoing mail on the server. There is no signature stored per person that anyone can edit, so there is nothing per person to check. If the rule is changed or removed in Exchange, SignCraft cannot see it from here.
        </p>
      </section>

      <SettingsSection status={status} onSaved={load} />
    </div>
  );
}
