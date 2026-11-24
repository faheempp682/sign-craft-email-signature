"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { CATEGORIES, PRESETS, type Category } from "@/lib/presets";

const PAGE = 24;

export function Gallery() {
  const [cat, setCat] = useState<Category | "All">("All");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return PRESETS.filter((p) => (cat === "All" || p.category === cat) && (!needle || p.name.toLowerCase().includes(needle)));
  }, [cat, q]);

  const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-medium transition-colors duration-150 ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-2 hover:text-ink"}`;

  return (
    <section aria-labelledby="tpl-h">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="tpl-h" className="text-lg font-semibold">
          Templates <span className="text-muted">({list.length})</span>
        </h2>
        <label className="sr-only" htmlFor="tpl-q">Search templates</label>
        <input id="tpl-q" className="field w-full sm:w-64" placeholder="Search templates…" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
      </div>
      <div role="group" aria-label="Category" className="mb-6 flex flex-wrap gap-2">
        {(["All", ...CATEGORIES] as const).map((c) => (
          <button key={c} type="button" aria-pressed={cat === c} className={chip(cat === c)} onClick={() => { setCat(c); setShown(PAGE); }}>
            {c}
          </button>
        ))}
      </div>

      <ul className="grid gap-5 md:grid-cols-2">
        {list.slice(0, shown).map((t) => (
          <li key={t.id} className="card overflow-hidden">
            {/* Real exporter output in a sandboxed iframe, so what you see is what ships. */}
            <iframe
              title={`${t.name} preview`}
              sandbox=""
              tabIndex={-1}
              loading="lazy"
              srcDoc={`<!doctype html><html><body style="margin:12px;background:#fff;zoom:0.8;">${renderToEmailHtml(t.doc)}</body></html>`}
              className="pointer-events-none h-64 w-full border-b border-line bg-white"
            />
            <div className="flex items-start justify-between gap-3 p-5">
              <div>
                <h3 className="font-semibold">{t.name}</h3>
                <p className="mt-1 text-sm text-muted">{t.category}</p>
              </div>
              <Link href={`/editor?t=${encodeURIComponent(t.id)}`} className="btn shrink-0">
                Use template
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="py-10 text-center text-muted">No templates match your search.</p>}
      {shown < list.length && (
        <div className="mt-8 text-center">
          <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({list.length - shown} left)
          </button>
        </div>
      )}
    </section>
  );
}
