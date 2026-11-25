"use client";

import { useEffect, useState } from "react";
import type { SignatureDoc } from "@/lib/schema/document";
import { VIEWPORTS, type ViewportId } from "@/lib/render/targets";
import { KindPill } from "./render-ui";

type Status = { enabled: boolean; message: string | null } | { error: string };
type Result = { target: string; viewport: ViewportId; kind: "real" | "simulation"; badge: string; label: string; width: number; height: number; cached: boolean; png: string };
type Skipped = { target: string; reason: string };

/**
 * "Render in all engines": asks /api/render to draw the signature in real Chromium, WebKit and Firefox and in the labelled
 * Gmail and Outlook-Word simulations, then shows the images side by side. Works only where the render service is switched on.
 */
export function RenderAll({ doc, dark, filename }: { doc: SignatureDoc; dark: boolean; filename: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [shownDark, setShownDark] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/render")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!live) return;
        setStatus(r.ok ? { enabled: !!j.enabled, message: j.message ?? null } : { error: j.message ?? "Rendered previews are not available for your account." });
      })
      .catch(() => live && setStatus({ error: "Could not reach the render service." }));
    return () => {
      live = false;
    };
  }, []);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ doc, dark }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? "The preview could not be rendered.");
      setResults(j.results);
      setSkipped(j.skipped ?? []);
      setShownDark(!!j.dark);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = status && "enabled" in status && status.enabled;
  const grouped = results ? (["desktop", "phone"] as ViewportId[]).map((v) => ({ v, items: results.filter((r) => r.viewport === v) })).filter((g) => g.items.length) : [];

  return (
    <section className="card overflow-hidden lg:col-span-2" aria-label="Rendered in real engines">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Render in all engines</h2>
          <p className="text-xs text-muted">Real Chromium, WebKit (Apple Mail) and Firefox (Thunderbird) images, plus labelled simulations of Gmail&apos;s clean-up and Outlook for Windows. Not real Outlook.</p>
        </div>
        <button className="btn btn-primary min-h-11" onClick={run} disabled={!ready || busy} aria-busy={busy}>
          {busy ? "Rendering…" : "Render in all engines"}
        </button>
      </div>
      <div className="space-y-4 p-4">
        {status === null && <p className="text-sm text-muted">Checking the render service…</p>}
        {status && "error" in status && <p role="status" className="text-sm text-muted">{status.error}</p>}
        {status && "enabled" in status && !status.enabled && <p role="status" className="text-sm text-muted">{status.message}</p>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        {skipped.length > 0 && (
          <ul className="space-y-1 text-sm text-muted">
            {skipped.map((s) => (
              <li key={s.target}>Skipped {s.target}: {s.reason}</li>
            ))}
          </ul>
        )}
        {grouped.map((g) => (
          <div key={g.v}>
            <h3 className="eyebrow mb-2">{VIEWPORTS[g.v].label}{shownDark ? " · dark" : " · light"}</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((r) => (
                <figure key={`${r.target}-${r.viewport}`} className="space-y-2 rounded-lg border border-line p-3">
                  <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
                    <span>{r.label}</span>
                    <KindPill kind={r.kind} />
                  </figcaption>
                  <div className="overflow-auto rounded border border-line bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`data:image/png;base64,${r.png}`} width={r.width} height={r.height} alt={`${r.label}, ${VIEWPORTS[r.viewport].label}, ${r.kind === "real" ? "real engine" : "simulation"}`} className="block h-auto max-w-full" style={{ width: r.width / VIEWPORTS[r.viewport].scale }} />
                  </div>
                  <a className="btn min-h-11 w-full" href={`data:image/png;base64,${r.png}`} download={`${filename}-${r.target}-${r.viewport}${shownDark ? "-dark" : ""}.png`}>
                    Download PNG
                  </a>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
