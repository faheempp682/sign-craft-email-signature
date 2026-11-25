"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { CATEGORIES, COLLECTIONS, DEFAULT_COLLECTION, PRESETS, type Category, type Collection } from "@/lib/presets";

const PAGE = 24;

const STAGE_H = 300;

/** Real exporter output on a uniform stage: centred and scaled down (never up) to fit, so every card lines up. */
function Preview({ title, html }: { title: string; html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    const fit = () => {
      const d = f.contentDocument;
      const box = d?.getElementById("w");
      if (!d || !box) return; // still about:blank (lazy iframe not loaded yet)
      box.style.zoom = "";
      const r = box.getBoundingClientRect();
      const z = Math.min(1, (f.clientWidth - 32) / r.width, (f.clientHeight - 32) / r.height);
      if (z < 1) box.style.zoom = String(z);
    };
    // A lazy iframe can finish loading before React attaches onLoad, so listen manually and also check right now.
    f.addEventListener("load", fit);
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(f);
    return () => {
      f.removeEventListener("load", fit);
      ro?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title={title}
      // allow-same-origin (no scripts) only so the page can measure the content; the markup is our own exporter output.
      sandbox="allow-same-origin"
      tabIndex={-1}
      loading="lazy"
      srcDoc={`<!doctype html><html><body style="margin:0;height:100vh;background:#f4f4f5;display:flex;align-items:center;justify-content:center;overflow:hidden;"><div id="w">${html}</div></body></html>`}
      style={{ height: STAGE_H }}
      className="pointer-events-none w-full border-b border-line"
    />
  );
}

export function Gallery() {
  const [col, setCol] = useState<Collection>(DEFAULT_COLLECTION);
  const [cat, setCat] = useState<Category | "All">("All");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return PRESETS.filter((p) => p.collection === col && (cat === "All" || p.category === cat) && (!needle || p.name.toLowerCase().includes(needle)));
  }, [col, cat, q]);
  const counts = useMemo(() => Object.fromEntries(COLLECTIONS.map((c) => [c, PRESETS.filter((p) => p.collection === c).length])) as Record<Collection, number>, []);

  const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-medium transition-colors duration-150 ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-2 hover:text-ink"}`;

  return (
    <section aria-labelledby="tpl-h">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="tpl-h" className="text-lg font-semibold">
          {col} <span className="text-muted">({list.length})</span>
        </h2>
        <label className="sr-only" htmlFor="tpl-q">Search templates</label>
        <input id="tpl-q" className="field w-full sm:w-64" placeholder="Search templates…" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
      </div>
      <div role="tablist" aria-label="Collection" className="mb-4 flex flex-wrap gap-2">
        {COLLECTIONS.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={col === c} className={chip(col === c)} onClick={() => { setCol(c); setCat("All"); setShown(PAGE); }}>
            {c} <span className="text-muted">{counts[c]}</span>
          </button>
        ))}
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
            <Preview title={`${t.name} preview`} html={renderToEmailHtml(t.doc)} />
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
