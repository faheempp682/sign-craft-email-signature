"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SignaturePreview } from "@/components/signature-preview";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { getStorage, saveDraft } from "@/lib/editor/draft";
import type { SignatureDoc } from "@/lib/schema/document";
import { CATEGORIES, COLLECTIONS, DEFAULT_COLLECTION, PRESETS, type Category, type Collection } from "@/lib/presets";

const PAGE = 24;

type Mine = { id: string; name: string; doc: SignatureDoc; created_at: string };
const MINE = "mine" as const;

/**
 * `pickPath` is where "Use template" goes, with ?t=<id> added. The default opens the editor; the create flow sends people to
 * its questions step instead.
 */
export function Gallery({ pickPath = "/editor", pickLabel = "Use template" }: { pickPath?: string; pickLabel?: string }) {
  const router = useRouter();
  const [col, setCol] = useState<Collection | typeof MINE>(DEFAULT_COLLECTION);
  /** null: not signed in or not available, so the tab is hidden. */
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [mineError, setMineError] = useState("");
  const [cat, setCat] = useState<Category | "All">("All");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let off = false;
    fetch("/api/templates/mine", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { templates: Mine[] } | null) => {
        if (!off && d) setMine(d.templates);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  const list = useMemo(() => {
    if (col === MINE) return [];
    const needle = q.trim().toLowerCase();
    return PRESETS.filter((p) => p.collection === col && (cat === "All" || p.category === cat) && (!needle || p.name.toLowerCase().includes(needle)));
  }, [col, cat, q]);
  const counts = useMemo(() => Object.fromEntries(COLLECTIONS.map((c) => [c, PRESETS.filter((p) => p.collection === c).length])) as Record<Collection, number>, []);

  const myList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (mine ?? []).filter((t) => !needle || t.name.toLowerCase().includes(needle));
  }, [mine, q]);

  /** A saved design is already complete, so it opens straight in the editor through the same draft the editor restores from. */
  function openMine(t: Mine) {
    const storage = getStorage();
    if (!storage || !saveDraft(storage, t.doc)) return setMineError("Your browser is blocking local storage, so the template could not be opened. Allow site data and try again.");
    router.push("/editor?from=template");
  }
  async function renameMine(t: Mine) {
    const name = window.prompt("Template name", t.name)?.trim();
    if (!name || name === t.name) return;
    const res = await fetch(`/api/templates/mine/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
    if (!res?.ok) return setMineError("Could not rename that template.");
    setMineError("");
    setMine((cur) => cur?.map((x) => (x.id === t.id ? { ...x, name } : x)) ?? cur);
  }
  async function deleteMine(t: Mine) {
    if (!window.confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/templates/mine/${t.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setMineError("Could not delete that template.");
    setMineError("");
    setMine((cur) => cur?.filter((x) => x.id !== t.id) ?? cur);
  }

  const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-medium transition-colors duration-150 ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-surface-2 hover:text-ink"}`;

  return (
    <section aria-labelledby="tpl-h">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="tpl-h" className="text-lg font-semibold">
          {col === MINE ? "My templates" : col} <span className="text-muted">({col === MINE ? myList.length : list.length})</span>
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
        {mine && (
          <button type="button" role="tab" aria-selected={col === MINE} className={chip(col === MINE)} onClick={() => { setCol(MINE); setCat("All"); setShown(PAGE); }}>
            My templates <span className="text-muted">{mine.length}</span>
          </button>
        )}
      </div>
      {col !== MINE && (
        <div role="group" aria-label="Category" className="mb-6 flex flex-wrap gap-2">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} className={chip(cat === c)} onClick={() => { setCat(c); setShown(PAGE); }}>
              {c}
            </button>
          ))}
        </div>
      )}

      {col === MINE && (
        <>
          {mineError && <p role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{mineError}</p>}
          <ul className="grid gap-5 md:grid-cols-2">
            {myList.map((t) => (
              <li key={t.id} className="card overflow-hidden">
                <SignaturePreview title={`${t.name} preview`} html={renderToEmailHtml(t.doc)} className="border-b border-line" />
                <div className="flex items-start justify-between gap-3 p-5">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{t.name}</h3>
                    <p className="mt-1 text-sm text-muted">
                      <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => void renameMine(t)}>Rename</button>
                      {" · "}
                      <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => void deleteMine(t)}>Delete</button>
                    </p>
                  </div>
                  <button type="button" className="btn shrink-0" onClick={() => openMine(t)}>Use template</button>
                </div>
              </li>
            ))}
          </ul>
          {myList.length === 0 && (
            <p className="py-10 text-center text-muted">
              {mine?.length ? "No templates match your search." : "Nothing saved yet. Design a signature with AI, then choose Save as template."}
            </p>
          )}
        </>
      )}

      {col !== MINE && <ul className="grid gap-5 md:grid-cols-2">
        {list.slice(0, shown).map((t) => (
          <li key={t.id} className="card overflow-hidden">
            {/* Real exporter output in a sandboxed iframe, so what you see is what ships. */}
            <SignaturePreview title={`${t.name} preview`} html={renderToEmailHtml(t.doc)} className="border-b border-line" />
            <div className="flex items-start justify-between gap-3 p-5">
              <div>
                <h3 className="font-semibold">{t.name}</h3>
                <p className="mt-1 text-sm text-muted">{t.category}</p>
              </div>
              <Link href={`${pickPath}?t=${encodeURIComponent(t.id)}`} className="btn shrink-0">
                {pickLabel}
              </Link>
            </div>
          </li>
        ))}
      </ul>}
      {col !== MINE && list.length === 0 && <p className="py-10 text-center text-muted">No templates match your search.</p>}
      {col !== MINE && shown < list.length && (
        <div className="mt-8 text-center">
          <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({list.length - shown} left)
          </button>
        </div>
      )}
    </section>
  );
}
