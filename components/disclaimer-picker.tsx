"use client";

import { useId, useState } from "react";
import { CATEGORY_LABEL, REVIEW_NOTE, type Disclaimer } from "@/lib/disclaimers/labels";
import { Select } from "@/components/ui/select";

/**
 * Lets someone start their signature's legal notice from a template. The text is COPIED into the signature (later
 * edits to a template do not change signatures already made), shown before it is inserted, and always carries the
 * reminder that the templates are starting points that need a lawyer's review.
 */
export function DisclaimerPicker({ hasDisclaimer, onInsert }: { hasDisclaimer: boolean; onInsert: (body: string) => void }) {
  const [list, setList] = useState<Disclaimer[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const selectId = useId();

  async function load() {
    if (list || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/disclaimers");
      const data = (await res.json().catch(() => null)) as { disclaimers?: Disclaimer[]; message?: string } | null;
      if (!res.ok || !data?.disclaimers) throw new Error(data?.message ?? "Could not load the templates.");
      setList(data.disclaimers);
      setChosen(data.disclaimers[0]?.id ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the templates.");
    } finally {
      setBusy(false);
    }
  }

  const picked = list?.find((d) => d.id === chosen);

  return (
    <details className="card p-4" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void load()}>
      <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem]">Insert a legal disclaimer</summary>
      <div className="mt-2 space-y-3 text-sm">
        {busy && <p className="text-muted">Loading templates…</p>}
        {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
        {list && list.length === 0 && <p className="text-muted">No templates are available yet. An admin can add them under Admin &gt; Disclaimers.</p>}
        {list && list.length > 0 && (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={selectId} className="font-medium">Template</label>
              <Select id={selectId} className="field w-full" value={chosen} onChange={(e) => { setChosen(e.target.value); setDone(""); }}>
                {list.map((d) => (
                  <option key={d.id} value={d.id}>{d.title} ({CATEGORY_LABEL[d.category]}, {d.jurisdiction})</option>
                ))}
              </Select>
            </div>
            {picked && <p className="max-h-40 overflow-auto rounded-lg border border-line bg-surface-2 p-3 text-xs leading-relaxed">{picked.body}</p>}
            <p className="text-xs text-muted">{REVIEW_NOTE}</p>
            <button
              type="button"
              className="btn min-h-11"
              disabled={!picked}
              onClick={() => {
                if (!picked) return;
                onInsert(picked.body);
                setDone(hasDisclaimer ? "Replaced the disclaimer in this signature." : "Added a disclaimer block to this signature.");
              }}
            >
              {hasDisclaimer ? "Replace the current disclaimer" : "Add to my signature"}
            </button>
            <p role="status" aria-live="polite" className="min-h-5 text-xs text-muted">{done}</p>
          </>
        )}
      </div>
    </details>
  );
}
