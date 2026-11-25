"use client";

import { useState } from "react";

/** A short text label that says the state in words (never colour alone). */
export function Pill({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "bad" | "good" | "warn" }) {
  const cls = tone === "bad" ? "border-red-600 text-red-600 dark:border-red-400 dark:text-red-400" : tone === "good" ? "border-emerald-700 text-emerald-700 dark:border-emerald-400 dark:text-emerald-400" : tone === "warn" ? "border-amber-700 text-amber-700 dark:border-amber-400 dark:text-amber-400" : "border-line text-muted";
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** The permanent label for anything SignCraft produces for an admin to run elsewhere. */
export function NotRunBanner({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-line p-3 text-sm" role="note">
      <strong>Generated, not run by SignCraft.</strong> {what}
    </p>
  );
}

/** A script on screen with copy and download buttons. */
export function CodeBox({ id, title, text, filename }: { id: string; title: string; text: string; filename: string }) {
  const [msg, setMsg] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copied to the clipboard.");
    } catch {
      setMsg("Could not copy. Select the text and copy it by hand.");
    }
  }
  function download() {
    // a byte-order mark so Windows PowerShell 5.1 reads the file as UTF-8
    const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMsg(`Downloaded ${filename}.`);
  }
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-h`} className="font-semibold">{title}</h3>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={copy}>Copy</button>
          <button type="button" className="btn" onClick={download}>Download</button>
        </div>
      </div>
      <pre tabIndex={0} aria-labelledby={`${id}-h`} className="max-h-96 overflow-auto whitespace-pre rounded-xl border border-line bg-surface-2 p-3 text-xs leading-relaxed">{text}</pre>
      <p aria-live="polite" className="min-h-5 text-sm text-muted">{msg}</p>
    </section>
  );
}

export function SetupCard({ steps, clientId, email, scope }: { steps: string[]; clientId?: string | null; email?: string | null; scope: string }) {
  return (
    <section className="card max-w-3xl space-y-4 p-4 sm:p-6" aria-labelledby="setup-h">
      <h2 id="setup-h" className="text-lg font-semibold">Gmail deployment is not set up yet</h2>
      <p className="text-sm text-muted">Nothing can be deployed until a Google Workspace admin has done these steps. SignCraft cannot do them for you.</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">Scope to authorise</dt>
        <dd className="break-all font-mono text-xs">{scope}</dd>
        {email && (
          <>
            <dt className="text-muted">Service account</dt>
            <dd className="break-all">{email}</dd>
          </>
        )}
        {clientId && (
          <>
            <dt className="text-muted">Client ID for the Admin console</dt>
            <dd className="font-mono text-xs">{clientId}</dd>
          </>
        )}
      </dl>
      <p className="text-sm text-muted">Full guide: docs/deploy-and-rules.md. This has not been tried against a real Workspace yet; see the verification steps there.</p>
    </section>
  );
}
