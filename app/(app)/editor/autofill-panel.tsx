"use client";

import { useMemo, useState } from "react";
import { applyAutofill, planAutofill, type ApplyResult, type FieldKey } from "@/lib/ai/apply-facts";
import type { AutofillResult } from "@/lib/ai/autofill";
import type { SignatureDoc } from "@/lib/schema/document";

type Mode = "text" | "url";
type Response = AutofillResult & { source: { type: Mode; host?: string; truncated: boolean }; cached: boolean };

const looksLikeLinkedIn = (v: string) => /(^|\/\/|\.)linkedin\.com/i.test(v.trim());

export function AutofillPanel({ doc, onApply }: { doc: SignatureDoc; onApply: (result: ApplyResult) => void }) {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Response | null>(null);
  const [selected, setSelected] = useState<Set<FieldKey>>(new Set());
  const [done, setDone] = useState("");

  // Recomputed against the live document, so the review always compares with what the signature says right now.
  const plan = useMemo(() => (result ? planAutofill(doc, result.facts) : []), [doc, result]);

  const canRun = !busy && (mode === "text" ? text.trim().length >= 10 : url.trim().length >= 4);

  async function run() {
    if (!canRun) return;
    setBusy(true);
    setError("");
    setDone("");
    setResult(null);
    try {
      const res = await fetch("/api/ai/autofill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "text" ? { type: "text", text } : { type: "url", url }),
      });
      const data = (await res.json().catch(() => null)) as (Partial<Response> & { message?: string }) | null;
      if (!res.ok || !data?.facts) {
        setError(res.status === 401 ? "Your session expired. Sign in again, then try once more." : (data?.message ?? "Something went wrong. Please try again."));
        return;
      }
      const r = data as Response;
      setResult(r);
      setSelected(new Set(planAutofill(doc, r.facts).filter((p) => p.recommended).map((p) => p.key)));
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: FieldKey) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function apply() {
    if (!result || selected.size === 0) return;
    onApply(applyAutofill(doc, result.facts, selected));
    setDone(`Added ${selected.size} detail${selected.size === 1 ? "" : "s"} to your signature. Check the preview.`);
    setResult(null);
  }

  const tab = (m: Mode) =>
    `min-h-11 rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${mode === m ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"}`;

  return (
    <section className="card space-y-4 p-5" aria-label="Autofill details">
      <div>
        <h2 className="text-sm font-semibold">Autofill details</h2>
        <p className="text-xs text-muted">Pull your name, job title and contact details from text or a web page. You review everything before it is applied.</p>
      </div>

      <div role="group" aria-label="Where to read from" className="flex gap-1">
        <button type="button" aria-pressed={mode === "text"} className={tab("text")} onClick={() => setMode("text")}>Paste text</button>
        <button type="button" aria-pressed={mode === "url"} className={tab("url")} onClick={() => setMode("url")}>Website</button>
      </div>

      {mode === "text" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="af-text" className="text-sm font-medium">Text with your details</label>
          <textarea id="af-text" className="field w-full py-2" rows={5} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste an old signature, a LinkedIn profile, a business card, or a bio..." />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="af-url" className="text-sm font-medium">Web page address</label>
          <input id="af-url" className="field w-full" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourcompany.com/team/jane" />
          {looksLikeLinkedIn(url) ? (
            <p className="text-xs text-amber-800 dark:text-amber-300">LinkedIn does not allow automated reading. Open the profile, copy the text, and use Paste text instead.</p>
          ) : (
            <p className="text-xs text-muted">Public pages only. The page is read once; nothing is crawled or stored.</p>
          )}
        </div>
      )}

      <button type="button" className="btn btn-primary w-full" onClick={run} disabled={!canRun}>
        {busy ? (mode === "url" ? "Reading the page..." : "Reading...") : "Find my details"}
      </button>

      <div role="status" aria-live="polite" className="min-h-5 text-sm">
        {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
        {done && <p className="text-accent">{done}</p>}
      </div>

      {result && (
        <div className="space-y-3 border-t border-line pt-4" data-testid="autofill-review">
          {result.found === 0 ? (
            <p className="text-sm text-muted">No contact details were found in that {mode === "text" ? "text" : "page"}. Nothing is guessed or made up, so try a source that states them.</p>
          ) : plan.length === 0 ? (
            <p className="text-sm text-muted">Everything found is already in your signature.</p>
          ) : (
            <>
              <p className="text-sm font-medium">Review what was found</p>
              <ul className="divide-y divide-line">
                {plan.map((p) => (
                  <li key={p.key}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                      <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={selected.has(p.key)} onChange={() => toggle(p.key)} aria-describedby={`af-${p.key}-d`} />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block font-medium">{p.label}</span>
                        <span id={`af-${p.key}-d`} className="block break-words text-muted">
                          {p.current && <><span className="line-through">{p.current}</span> {"->"} </>}
                          <span className="text-ink">{p.proposed}</span>
                        </span>
                        {p.mode === "replace" && <span className="mt-0.5 inline-block rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Replaces what you wrote</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-primary" onClick={apply} disabled={selected.size === 0}>Apply selected ({selected.size})</button>
                <button type="button" className="btn" onClick={() => setResult(null)}>Discard</button>
              </div>
            </>
          )}

          {result.dropped.length > 0 && (
            <p className="text-xs text-muted">Ignored because they could not be verified in the {mode === "text" ? "text" : "page"}: {result.dropped.join(", ")}.</p>
          )}
          {result.source.truncated && <p className="text-xs text-muted">The page was very long, so only its first part was read.</p>}
          {result.cached && <p className="text-xs text-muted">Showing a saved result from earlier. No new AI request was made.</p>}
        </div>
      )}
    </section>
  );
}
