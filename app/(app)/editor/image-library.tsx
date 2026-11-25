"use client";

import { useState } from "react";
import type { AssetInfo } from "@/lib/storage/rules";

type Row = { url: string; type: AssetInfo["type"]; size: number; width: number | null; height: number | null; animated: boolean; original_size: number | null };

/** "Your images": the user's earlier uploads (stored in their own Bunny folder) as a grid to pick from. */
export function ImageLibrary({ current, onPick }: { current: string; onPick: (url: string, info: AssetInfo) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/upload", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { images?: Row[]; message?: string } | null;
      if (!res.ok || !data?.images) throw new Error(data?.message ?? "Could not load your images.");
      setRows(data.images);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load your images.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn w-full" aria-expanded={open} onClick={() => void toggle()}>{open ? "Hide your images" : "Choose from your images"}</button>
      {open && (
        <div data-testid="image-library" className="rounded-lg border border-line p-2">
          {loading && <p className="text-xs text-muted">Loading…</p>}
          {err && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{err}</p>}
          {rows && rows.length === 0 && <p className="text-xs text-muted">No uploaded images yet. Upload one above and it will show up here.</p>}
          {rows && rows.length > 0 && (
            <ul className="grid max-h-64 grid-cols-3 gap-2 overflow-auto">
              {rows.map((r) => (
                <li key={r.url}>
                  <button
                    type="button"
                    title={`${r.width ?? "?"} × ${r.height ?? "?"}`}
                    aria-label={`Use image ${r.width ?? "?"} by ${r.height ?? "?"}`}
                    aria-pressed={r.url === current}
                    className={`block aspect-square w-full overflow-hidden rounded-md border bg-surface-2 ${r.url === current ? "border-accent ring-2 ring-accent" : "border-line"}`}
                    onClick={() => onPick(r.url, { type: r.type, bytes: r.size, width: r.width ?? 0, height: r.height ?? 0, animated: r.animated, originalBytes: r.original_size ?? undefined })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt="" loading="lazy" className="size-full object-contain" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
