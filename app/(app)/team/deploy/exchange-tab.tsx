"use client";

import { useState } from "react";
import { call, Field, Status, useAction } from "../api";
import { CodeBox, NotRunBanner, Pill } from "./ui";
import { Select } from "@/components/ui/select";

type Generated = {
  script: string;
  removal_script: string;
  rules: { index: number; name: string; templateName: string; sentence: string; unverified: string[]; htmlLength: number }[];
  warnings: string[];
  omitted: { name: string; reason: string }[];
  summary: string[];
  recorded: string | null;
};

const MODES = [
  { id: "Audit", label: "Audit only (recommended first): log what would happen, change nothing" },
  { id: "AuditAndNotify", label: "Audit and notify: log and notify, change nothing" },
  { id: "Enforce", label: "Enforce: add the signature to real mail" },
] as const;
const FALLBACKS = [
  { id: "Ignore", label: "Ignore (recommended): send the mail without the signature" },
  { id: "Wrap", label: "Wrap: attach the original mail to a new message that carries the signature" },
  { id: "Reject", label: "Reject: bounce the mail back to the sender" },
] as const;

export function ExchangeTab() {
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("Audit");
  const [fallback, setFallback] = useState<(typeof FALLBACKS)[number]["id"]>("Ignore");
  const [priorityKind, setPriorityKind] = useState<"end" | "number">("end");
  const [priority, setPriority] = useState("0");
  const [guard, setGuard] = useState("");
  const [out, setOut] = useState<Generated | null>(null);
  const [helper, setHelper] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const { busy, error, run } = useAction();

  async function generate() {
    setProblems([]);
    const body = { mode, fallback, priority: priorityKind === "end" ? "end" : Number(priority), duplicate_guard: guard.trim(), record: true };
    if (priorityKind === "number" && !(Number.isInteger(body.priority) && (body.priority as number) >= 0)) return setProblems(["The priority must be a whole number, 0 or more."]);
    const r = await run("gen", () => call<Generated>("POST", "/api/deploy/exchange/script", body));
    if (r.ok) setOut(r.data);
    else {
      setOut(null);
      setProblems([r.message]);
    }
  }
  async function loadHelper() {
    const r = await run("helper", () => call<{ script: string }>("GET", "/api/deploy/exchange/helper"));
    if (r.ok) setHelper(r.data.script);
  }

  return (
    <div className="space-y-8">
      <section className="card max-w-3xl space-y-4 p-4 sm:p-6" aria-labelledby="x-h">
        <h2 id="x-h" className="text-lg font-semibold">Microsoft 365 and Outlook</h2>
        <p className="text-sm text-muted">
          Microsoft has no way to set a person&apos;s Outlook signature from outside, and its Graph API cannot manage mail flow rules. The supported server-side route is an Exchange Online <strong className="text-ink">mail flow rule</strong> that appends your signature to outgoing mail. SignCraft writes a PowerShell script for it. <strong className="text-ink">You read the script and run it yourself.</strong> One rule serves everyone: Exchange fills each person&apos;s name, title and phone from your Microsoft 365 directory.
        </p>
        <NotRunBanner what="SignCraft never connects to your Microsoft 365 tenant. Not yet tested against a real tenant: start in Audit mode." />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="x-mode" label="Rule mode">
            <Select id="x-mode" className="field w-full" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </Field>
          <Field id="x-fb" label="If the signature cannot be added (encrypted or signed mail)" hint="Ignore never blocks or alters mail.">
            <Select id="x-fb" className="field w-full" value={fallback} onChange={(e) => setFallback(e.target.value as typeof fallback)}>
              {FALLBACKS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </Field>
          <Field id="x-prio" label="Rule priority" hint="After all your existing rules is safest. A number means that position (0 is first).">
            <Select id="x-prio" className="field w-full" value={priorityKind} onChange={(e) => setPriorityKind(e.target.value as "end" | "number")}>
              <option value="end">After every rule that already exists</option>
              <option value="number">A fixed starting number</option>
            </Select>
          </Field>
          {priorityKind === "number" && (
            <Field id="x-num" label="Starting priority number">
              <input id="x-num" className="field w-full" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </Field>
          )}
          <Field id="x-guard" label="Skip mail that already contains this phrase (optional)" hint="A phrase from your signature, so a reply thread does not get it twice. Not yet verified.">
            <input id="x-guard" className="field w-full" value={guard} maxLength={100} onChange={(e) => setGuard(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={generate}>{busy === "gen" ? "Generating…" : "Generate script"}</button>
        </div>
        {problems.length > 0 && (
          <div role="alert" className="rounded-lg border border-red-600 p-3 text-sm dark:border-red-400">
            {problems.map((p) => <p key={p}>{p}</p>)}
          </div>
        )}
        <Status error={problems.length ? "" : error} notice="" />
      </section>

      {out && (
        <section aria-labelledby="w-h" className="space-y-5">
          <h2 id="w-h" className="text-lg font-semibold">What this will do</h2>
          <NotRunBanner what="Review it, then run it in a PowerShell session you control." />
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {out.summary.map((s) => <li key={s}>{s}</li>)}
          </ul>
          <ol className="space-y-2 text-sm" aria-label="Rules in order">
            {out.rules.map((r) => (
              <li key={r.index} className="rounded-lg border border-line p-3">
                <p>{r.sentence}</p>
                <p className="mt-1 text-muted">{r.htmlLength.toLocaleString("en-GB")} of 5,000 characters.</p>
                {r.unverified.length > 0 && <p className="mt-1"><Pill tone="warn">Unverified</Pill> <span className="text-muted">{r.unverified.join("; ")}.</span></p>}
              </li>
            ))}
          </ol>
          {out.omitted.length > 0 && (
            <div role="note" className="rounded-lg border border-line p-3 text-sm">
              <p className="font-semibold">Left out of the script</p>
              {out.omitted.map((o) => <p key={o.name} className="text-muted">{o.name}: {o.reason}</p>)}
            </div>
          )}
          {out.warnings.length > 0 && (
            <div role="note" className="rounded-lg border border-line p-3 text-sm">
              <p className="font-semibold">Check before you run it</p>
              {out.warnings.map((w) => <p key={w} className="text-muted">{w}</p>)}
            </div>
          )}
          <CodeBox id="script" title="Script: create or update the rules" text={out.script} filename="signcraft-exchange-rules.ps1" />
          <CodeBox id="removal" title="Script: remove everything SignCraft made" text={out.removal_script} filename="signcraft-exchange-remove.ps1" />
        </section>
      )}

      <section className="card max-w-3xl space-y-4 p-4 sm:p-6" aria-labelledby="hp-h">
        <h2 id="hp-h" className="text-lg font-semibold">Export your Microsoft 365 directory</h2>
        <p className="text-sm text-muted">A read-only PowerShell helper that reads your users and saves a CSV on your own computer. Upload that file under Team, Import. It changes nothing in Microsoft 365. Not yet tested against a real tenant: check the CSV before importing.</p>
        {!helper ? <button type="button" className="btn" disabled={busy !== null} onClick={loadHelper}>Show the helper script</button> : <CodeBox id="helper" title="Script: export directory to CSV" text={helper} filename="signcraft-export-people.ps1" />}
      </section>
    </div>
  );
}
