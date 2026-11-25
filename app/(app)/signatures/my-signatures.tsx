"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import type { SignatureDoc } from "@/lib/schema/document";
import { RequestPolish } from "@/components/request-polish";

export type MySignature = { id: string; name: string; updatedAt: string; doc: SignatureDoc };

const fmt = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(iso));

/**
 * Server and browser must render identical text on first paint or React reports a hydration mismatch, so the first
 * render is a fixed-locale UTC date. After mount it switches to the viewer's own local date.
 */
function UpdatedDate({ iso }: { iso: string }) {
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);
  return <time dateTime={iso}>{fmt(iso, local ? undefined : "UTC")}</time>;
}

export function MySignatures({ items, limit }: { items: MySignature[]; limit?: number }) {
  const full = limit !== undefined && items.length >= limit;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function remove(s: MySignature) {
    if (!window.confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
    setBusy(s.id);
    setError("");
    try {
      const res = await fetch(`/api/signatures/${s.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message ?? "Could not delete. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="mine-h" className="mb-12">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="mine-h" className="text-lg font-semibold">
          My signatures <span className="text-muted">({limit === undefined ? items.length : `${items.length} of ${limit}`})</span>
        </h2>
        {full ? (
          <p className="text-sm text-muted">You have reached the limit. Delete one to create another.</p>
        ) : (
          <Link href="/create" className="btn btn-primary">New signature</Link>
        )}
      </div>
      <p role="alert" className="mb-3 min-h-5 text-sm text-red-600 dark:text-red-400">{error}</p>
      {items.length === 0 ? (
        <div className="card p-6 text-sm text-muted">
          Nothing saved yet. Press <strong className="text-ink">New signature</strong> to pick a template and make your first one.
        </div>
      ) : (
        <ul className="grid gap-5 md:grid-cols-2">
          {items.map((s) => (
            <li key={s.id} className="card overflow-hidden">
              <iframe
                title={`${s.name} preview`}
                sandbox=""
                tabIndex={-1}
                loading="lazy"
                srcDoc={`<!doctype html><html><body style="margin:12px;background:#fff;zoom:0.8;">${renderToEmailHtml(s.doc)}</body></html>`}
                className="pointer-events-none h-64 w-full border-b border-line bg-white"
              />
              <div className="flex items-start justify-between gap-3 p-5">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{s.name}</h3>
                  <p className="mt-1 text-sm text-muted">Updated <UpdatedDate iso={s.updatedAt} /></p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link href={`/editor?s=${s.id}`} className="btn btn-primary">Edit</Link>
                  <RequestPolish signatureId={s.id} origin="manual" />
                  <button className="btn" disabled={busy === s.id} onClick={() => remove(s)} aria-label={`Delete ${s.name}`}>
                    {busy === s.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
