"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ORIGIN_LABEL, STATUS_LABEL, type PolishOrigin, type PolishStatus } from "@/lib/polish/status";
import type { PolishSummary } from "@/lib/polish/route";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import type { SignatureDoc } from "@/lib/schema/document";
import { cn } from "@/lib/utils";

const TONE: Record<PolishStatus, string> = {
  requested: "bg-accent-soft text-ink",
  in_progress: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  delivered: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  accepted: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  declined: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-accent-soft text-muted",
};

/** The status is always written out, never colour alone. */
export function StatusBadge({ status, className }: { status: PolishStatus; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", TONE[status], className)}>{STATUS_LABEL[status]}</span>;
}

export function OriginPill({ origin }: { origin: PolishOrigin }) {
  return <span className="inline-flex items-center rounded-full border border-line px-2.5 py-1 text-xs text-muted">{ORIGIN_LABEL[origin]}</span>;
}

const fmt = (iso: string, timeZone?: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));

/** Server and browser must print the same text on first paint, so the first render is UTC; it switches to local time after mount. */
export function When({ iso }: { iso: string }) {
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);
  const valid = !Number.isNaN(new Date(iso).getTime());
  if (!valid) return null;
  return <time dateTime={iso}>{fmt(iso, local ? undefined : "UTC")}</time>;
}

/** The signature exactly as the real renderer produces it, in a script-free sandbox that grows to fit its content. */
export function SignaturePreview({ doc, title }: { doc: SignatureDoc; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const fit = () => {
    const body = frame.current?.contentDocument?.body;
    if (body) setHeight(Math.min(Math.max(body.scrollHeight + 8, 120), 520));
  };
  return (
    <iframe
      ref={frame}
      title={title}
      // allow-same-origin only lets us measure the height; no scripts, forms, popups or navigation are allowed.
      sandbox="allow-same-origin"
      onLoad={fit}
      srcDoc={`<!doctype html><html><body style="margin:16px;background:#fff;">${renderToEmailHtml(doc)}</body></html>`}
      style={{ height }}
      className="pointer-events-none w-full rounded-xl border border-line bg-white"
    />
  );
}

export function RequestList({ items, empty }: { items: PolishSummary[]; empty: React.ReactNode }) {
  if (items.length === 0) return <div className="card p-6 text-sm text-muted">{empty}</div>;
  return (
    <ul className="card divide-y divide-line">
      {items.map((r) => (
        <li key={r.id}>
          <Link href={`/polish/${r.id}`} className="flex flex-col gap-2 px-4 py-4 transition-colors hover:bg-surface-2 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.signatureName}</span>
              <StatusBadge status={r.status} />
              <OriginPill origin={r.origin} />
              {r.round > 1 && <span className="text-xs text-muted">Round {r.round}</span>}
            </div>
            <p className="line-clamp-2 text-sm text-muted">{r.note}</p>
            <p className="text-xs text-muted">
              Requested <When iso={r.createdAt} />
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
