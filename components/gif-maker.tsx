"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trapTab, useModalFocus } from "@/components/image-cropper";
import { GifDisabledError, requestGif, type GifResult } from "@/lib/gif/client";
import { GIF_LIMITS, sizeLevel, type SizeLevel } from "@/lib/gif/limits";
import { LIMITS, formatBytes } from "@/lib/storage/rules";

export type GifMakerProps = {
  /** Banner size the GIF should match (the schema range is 100-600 x 20-300). */
  width?: number;
  height?: number;
  /** Receives the finished GIF as a file. The parent uploads it through the normal upload flow. Reject to show an error. */
  onUse: (gif: File) => Promise<void>;
  onClose: () => void;
};

type Frame = { key: number; file: File; url: string; delay: number };

const LOOPS: { value: number; label: string }[] = [
  { value: 0, label: "Forever" },
  { value: 1, label: "Once" },
  { value: 2, label: "Twice" },
  { value: 3, label: "3 times" },
  { value: 5, label: "5 times" },
  { value: 10, label: "10 times" },
];

const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)));

const LEVEL_TEXT: Record<SizeLevel, string> = {
  ok: "Within the guideline",
  warning: "Over the 300 KB guideline: it will load slowly",
  error: "Over 1 MB: most email clients will stall or skip it",
};
const LEVEL_BAR: Record<SizeLevel, string> = { ok: "bg-emerald-600", warning: "bg-amber-500", error: "bg-red-600" };
const LEVEL_TEXT_CLASS: Record<SizeLevel, string> = { ok: "text-emerald-700 dark:text-emerald-400", warning: "text-amber-700 dark:text-amber-400", error: "text-red-600 dark:text-red-400" };

export function GifMaker({ width = 400, height = 100, onUse, onClose }: GifMakerProps) {
  const uid = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const framesRef = useRef<Frame[]>([]);
  const [mounted, setMounted] = useState(false);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [loop, setLoop] = useState(0);
  const [w, setW] = useState(clampInt(width, GIF_LIMITS.width.min, GIF_LIMITS.width.max));
  const [h, setH] = useState(clampInt(height, GIF_LIMITS.height.min, GIF_LIMITS.height.max));
  const [result, setResult] = useState<(GifResult & { url: string; sig: string }) | null>(null);
  const [busy, setBusy] = useState<"" | "build" | "use">("");
  const [err, setErr] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [note, setNote] = useState("");

  framesRef.current = frames;
  useEffect(() => setMounted(true), []);
  useModalFocus(dialogRef, mounted, () => { if (!busy) onClose(); });

  // Release object URLs when the dialog closes.
  const resultUrl = result?.url;
  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);
  useEffect(() => () => framesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  /** What a built GIF depends on. When it changes the preview is stale. */
  const sig = useMemo(() => JSON.stringify([frames.map((f) => [f.key, f.delay]), loop, w, h]), [frames, loop, w, h]);
  const stale = !!result && result.sig !== sig;
  const fresh = result && !stale ? result : null;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setNote("");
    const room = GIF_LIMITS.maxFrames - frames.length;
    const picked = Array.from(list);
    const okType = picked.filter((f) => ["image/png", "image/jpeg", "image/gif"].includes(f.type));
    const okSize = okType.filter((f) => f.size <= GIF_LIMITS.maxFrameBytes);
    const added = okSize.slice(0, Math.max(0, room));
    const msgs: string[] = [];
    if (okType.length < picked.length) msgs.push("Only PNG, JPEG or GIF images can be used as frames.");
    if (okSize.length < okType.length) msgs.push("Each frame must be under 2 MB.");
    if (okSize.length > room) msgs.push(`A GIF can have at most ${GIF_LIMITS.maxFrames} frames.`);
    setNote(msgs.join(" "));
    if (added.length) setFrames((cur) => [...cur, ...added.map((file) => ({ key: ++seq.current, file, url: URL.createObjectURL(file), delay: GIF_LIMITS.defaultDelayMs }))]);
  }

  const move = (i: number, dir: -1 | 1) =>
    setFrames((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) =>
    setFrames((cur) => {
      URL.revokeObjectURL(cur[i].url);
      return cur.filter((_, k) => k !== i);
    });
  const setDelay = (i: number, v: number) => setFrames((cur) => cur.map((f, k) => (k === i ? { ...f, delay: clampInt(v, GIF_LIMITS.minDelayMs, GIF_LIMITS.maxDelayMs) } : f)));

  const canBuild = frames.length >= GIF_LIMITS.minFrames && !busy && !disabled;

  async function build() {
    if (!canBuild) return;
    setBusy("build");
    setErr("");
    try {
      const r = await requestGif(frames.map((f) => f.file), { delays: frames.map((f) => f.delay), loop, width: w, height: h });
      setResult({ ...r, url: URL.createObjectURL(r.blob), sig });
    } catch (e) {
      if (e instanceof GifDisabledError) setDisabled(true);
      setErr(e instanceof Error ? e.message : "The GIF could not be created.");
    } finally {
      setBusy("");
    }
  }

  async function use() {
    if (!fresh || busy) return;
    setBusy("use");
    setErr("");
    try {
      await onUse(new File([fresh.blob], "animated-banner.gif", { type: "image/gif" }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The upload failed. Please try again.");
      setBusy("");
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    trapTab(e, dialogRef.current);
  }

  if (!mounted) return null;

  const level = fresh ? sizeLevel(fresh.bytes, LIMITS.gifWarnBytes, LIMITS.gifErrorBytes) : null;
  const meterMax = LIMITS.gifErrorBytes;
  const fill = fresh ? Math.min(100, (fresh.bytes / meterMax) * 100) : 0;
  const guide = (LIMITS.gifWarnBytes / meterMax) * 100;
  const iconBtn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] border border-line bg-surface text-base hover:bg-surface-2 disabled:opacity-40";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-t`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="card flex max-h-[100dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-b-none p-4 text-ink shadow-xl outline-none sm:max-h-[92dvh] sm:rounded-b-[16px] sm:p-5"
      >
        <div>
          <h2 id={`${uid}-t`} className="text-base font-semibold">Animated GIF banner</h2>
          <p className="mt-1 text-sm text-muted">Pick 2 to 6 still images. They play in the order shown, each for its own delay.</p>
        </div>

        <p className="rounded-[10px] border border-line bg-surface-2 p-3 text-sm" data-testid="outlook-note">
          <strong>Outlook on Windows shows only the first frame.</strong> Make sure frame 1 is complete on its own, with the message and any call to action.
        </p>

        {disabled && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p>}

        <section aria-label="Frames" className="space-y-3">
          <ul className="space-y-2">
            {frames.map((f, i) => (
              <li key={f.key} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line p-2" data-testid="gif-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={`Frame ${i + 1} preview`} className="h-12 w-20 shrink-0 rounded border border-line object-contain" />
                <div className="min-w-0 flex-1 basis-32">
                  <p className="truncate text-sm font-medium">Frame {i + 1}{i === 0 ? " (shown in Outlook)" : ""}</p>
                  <p className="truncate text-xs text-muted">{f.file.name} · {formatBytes(f.file.size)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <label htmlFor={`${uid}-d${f.key}`} className="sr-only">Frame {i + 1} delay in milliseconds</label>
                  <input id={`${uid}-d${f.key}`} type="number" inputMode="numeric" min={GIF_LIMITS.minDelayMs} max={GIF_LIMITS.maxDelayMs} step={100} value={f.delay} onChange={(e) => setDelay(i, Number(e.target.value))} className="field w-24" />
                  <span className="text-xs text-muted" aria-hidden="true">ms</span>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className={iconBtn} aria-label={`Move frame ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className={iconBtn} aria-label={`Move frame ${i + 1} down`} disabled={i === frames.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button type="button" className={iconBtn} aria-label={`Remove frame ${i + 1}`} onClick={() => remove(i)}>×</button>
                </div>
              </li>
            ))}
          </ul>
          {frames.length < GIF_LIMITS.maxFrames && (
            <label className="btn w-full cursor-pointer">
              {frames.length === 0 ? "Choose frames" : "Add more frames"}
              <input type="file" multiple accept="image/png,image/jpeg,image/gif" className="sr-only" aria-label="Add frame images" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
          )}
          <p role="status" aria-live="polite" className="min-h-4 text-xs text-red-600 dark:text-red-400">{note}</p>
          {frames.length === 1 && <p className="text-xs text-muted">Add at least one more frame.</p>}
        </section>

        <section aria-label="Settings" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-loop`} className="text-sm font-medium">Repeat</label>
            <select id={`${uid}-loop`} className="field w-full" value={loop} onChange={(e) => setLoop(Number(e.target.value))}>
              {LOOPS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-w`} className="text-sm font-medium">Width (px)</label>
            <input id={`${uid}-w`} type="number" inputMode="numeric" className="field w-full" min={GIF_LIMITS.width.min} max={GIF_LIMITS.width.max} value={w} onChange={(e) => setW(Number(e.target.value))} onBlur={() => setW((v) => clampInt(v, GIF_LIMITS.width.min, GIF_LIMITS.width.max))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-h`} className="text-sm font-medium">Height (px)</label>
            <input id={`${uid}-h`} type="number" inputMode="numeric" className="field w-full" min={GIF_LIMITS.height.min} max={GIF_LIMITS.height.max} value={h} onChange={(e) => setH(Number(e.target.value))} onBlur={() => setH((v) => clampInt(v, GIF_LIMITS.height.min, GIF_LIMITS.height.max))} />
          </div>
          <p className="col-span-full text-xs text-muted">Frames that are a different shape are centred on white, never stretched.</p>
        </section>

        <section aria-label="Preview and size" className="space-y-3">
          <button type="button" className="btn w-full" disabled={!canBuild} onClick={() => void build()}>{busy === "build" ? "Building…" : result ? "Rebuild preview" : "Build preview"}</button>

          {result && (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.url} alt="Preview of the animated banner" className="mx-auto max-h-48 max-w-full rounded border border-line" />
              {stale && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Settings changed since this preview. Rebuild it before using it.</p>}
            </div>
          )}

          {fresh && level && (
            <div data-testid="size-meter">
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-medium">{formatBytes(fresh.bytes)}</span>
                <span className={`text-xs ${LEVEL_TEXT_CLASS[level]}`}>{LEVEL_TEXT[level]}</span>
              </div>
              <div
                role="meter"
                aria-label="GIF file size"
                aria-valuemin={0}
                aria-valuemax={Math.round(meterMax / 1024)}
                aria-valuenow={Math.min(Math.round(meterMax / 1024), Math.max(1, Math.round(fresh.bytes / 1024)))}
                aria-valuetext={`${formatBytes(fresh.bytes)}. ${LEVEL_TEXT[level]}`}
                className="relative h-3 w-full overflow-hidden rounded-full border border-line bg-surface-2"
              >
                <div className={`h-full ${LEVEL_BAR[level]}`} style={{ width: `${fill}%` }} />
                <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${guide}%` }} aria-hidden="true" />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true"><span>0</span><span>300 KB guideline</span><span>1 MB</span></div>
              {fresh.colours < 256 && <p className="mt-1 text-xs text-muted">To shrink the file the colours were reduced to {fresh.colours}. Fewer frames or simpler images keep more colours.</p>}
            </div>
          )}
        </section>

        {err && !disabled && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn" onClick={onClose} disabled={busy === "use"}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!fresh || level === "error" || busy !== ""} onClick={() => void use()}>{busy === "use" ? "Uploading…" : "Use this GIF"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
