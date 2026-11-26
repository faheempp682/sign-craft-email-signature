"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CropLoadError, loadCropSource, renderCrop, type CropSource } from "@/lib/editor/crop-canvas";
import { clampState, cropRect, initialState, maskRadius, maxZoomFor, nudge, outputSize, panBy, zoomBy, zoomTo, type CropState, type Size } from "@/lib/editor/crop";
import type { UploadPurpose } from "@/lib/storage/rules";

export type ImageCropperProps = {
  file: File;
  /** Width / height of the crop window (1 for a photo, the banner's own ratio for a banner). */
  aspect: number;
  /** Shows a height slider so the person can make the crop window taller or shorter (banners). The result's shape follows. */
  adjustHeight?: boolean;
  /** The block's chosen shape; only used to preview the result with a matching mask. */
  shape?: string;
  purpose: UploadPurpose;
  title?: string;
  confirmLabel?: string;
  onConfirm: (cropped: File) => void;
  onCancel: () => void;
  /** When given, shows "Use the whole image" which hands the original file back unchanged. */
  onUseOriginal?: () => void;
};

const KEY_STEP = 0.05; // arrow keys move by 5% of the visible region (25% with Shift)
const ZOOM_STEP = 1.15;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';

/** Modal behaviour shared by the dialogs: move focus in, give it back on close, and stop the page behind from scrolling. */
export function useModalFocus(ref: React.RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void) {
  const esc = useRef(onEscape);
  esc.current = onEscape;
  // Escape works even when focus has fallen to the page (for example a button that was disabled while busy).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        esc.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [active, ref]);
}

/** Keeps Tab and Shift+Tab inside the dialog. Call from its keydown handler. */
export function trapTab(e: React.KeyboardEvent, dialog: HTMLElement | null) {
  if (e.key !== "Tab" || !dialog) return;
  const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === dialog)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

export function ImageCropper({ file, aspect: initialAspect, adjustHeight = false, shape, purpose, title = "Crop image", confirmLabel = "Crop and upload", onConfirm, onCancel, onUseOriginal }: ImageCropperProps) {
  const uid = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const srcRef = useRef<CropSource | null>(null);
  const stateRef = useRef<CropState>({ zoom: 1, cx: 0, cy: 0 });
  const viewSize = useRef<Size>({ w: 0, h: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const [aspect, setAspect] = useState(initialAspect);
  const aspectRef = useRef(initialAspect);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [state, setState] = useState<CropState>(stateRef.current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mounted, setMounted] = useState(false);

  const img = (): Size => ({ w: srcRef.current?.width ?? 1, h: srcRef.current?.height ?? 1 });

  const commit = useCallback((next: CropState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => setMounted(true), []);

  /* Load and decode the file (EXIF rotation applied, huge images scaled down). */
  useEffect(() => {
    let dead = false;
    let src: CropSource | null = null;
    loadCropSource(file)
      .then((s) => {
        if (dead) return s.close();
        src = s;
        srcRef.current = s;
        commit(initialState({ w: s.width, h: s.height }, aspectRef.current));
        setReady(true);
      })
      .catch((e) => !dead && setLoadError(e instanceof CropLoadError ? e.message : "That file could not be opened as an image."));
    return () => {
      dead = true;
      srcRef.current = null;
      src?.close();
    };
  }, [file, commit]);

  /* Draw the visible region onto the canvas whenever anything changes. */
  const draw = useCallback(() => {
    const c = canvasRef.current;
    const s = srcRef.current;
    const v = viewSize.current;
    if (!c || !s || v.w <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(v.w * dpr);
    const h = Math.round(v.h * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    if (adjustHeight) {
      // Frame mode: the stage shows the whole picture; a second canvas previews exactly what the frame will keep.
      ctx.drawImage(s.drawable, 0, 0, s.width, s.height, 0, 0, w, h);
      const pc = previewRef.current;
      const pctx = pc?.getContext("2d");
      if (pc && pctx) {
        const pw = Math.round((pc.clientWidth || 420) * dpr);
        const ph = Math.max(1, Math.round(pw / aspect));
        if (pc.width !== pw || pc.height !== ph) {
          pc.width = pw;
          pc.height = ph;
        }
        const r = cropRect(stateRef.current, img(), aspect);
        pctx.clearRect(0, 0, pw, ph);
        pctx.imageSmoothingQuality = "high";
        pctx.drawImage(s.drawable, r.x, r.y, r.w, r.h, 0, 0, pw, ph);
      }
      return;
    }
    const r = cropRect(stateRef.current, img(), aspect);
    ctx.drawImage(s.drawable, r.x, r.y, r.w, r.h, 0, 0, w, h);
  }, [aspect, adjustHeight]);

  useEffect(() => {
    if (ready) draw();
  }, [ready, state, draw]);

  /* Track the viewport's size. */
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !ready) return;
    const measure = () => {
      viewSize.current = { w: el.clientWidth, h: el.clientHeight };
      draw();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, draw, mounted]);

  /* Wheel zoom needs a non-passive listener so the page does not scroll too. */
  useEffect(() => {
    const el = viewRef.current;
    if (!el || !ready) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const focus = { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
      commit(zoomBy(stateRef.current, e.deltaY < 0 ? 1.1 : 1 / 1.1, img(), aspect, focus));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ready, aspect, commit, mounted]);

  useModalFocus(dialogRef, mounted, onCancel);

  useEffect(() => {
    if (ready) viewRef.current?.focus();
  }, [ready]);

  async function confirm() {
    const s = srcRef.current;
    if (!s || busy) return;
    setBusy(true);
    setErr("");
    try {
      const rect = cropRect(stateRef.current, img(), aspect);
      onConfirm(await renderCrop(s, rect, outputSize(rect, purpose)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The cropped image could not be created.");
      setBusy(false);
    }
  }

  /* Dialog-level keys: Esc cancels, Enter confirms (unless a button has focus), Tab stays inside. */
  function onDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && ready && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      void confirm();
      return;
    }
    trapTab(e, dialogRef.current);
  }

  /* Keys on the crop area itself. */
  function onViewKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? KEY_STEP * 5 : KEY_STEP;
    const s = stateRef.current;
    const d = img();
    let next: CropState | null = null;
    if (e.key === "ArrowLeft") next = nudge(s, -step, 0, d, aspect);
    else if (e.key === "ArrowRight") next = nudge(s, step, 0, d, aspect);
    else if (e.key === "ArrowUp") next = nudge(s, 0, -step, d, aspect);
    else if (e.key === "ArrowDown") next = nudge(s, 0, step, d, aspect);
    else if (e.key === "+" || e.key === "=") next = zoomBy(s, ZOOM_STEP, d, aspect);
    else if (e.key === "-" || e.key === "_") next = zoomBy(s, 1 / ZOOM_STEP, d, aspect);
    else if (e.key === "0") next = initialState(d, aspect);
    if (next) {
      e.preventDefault();
      e.stopPropagation();
      commit(next);
    }
  }

  /* Pointer: one finger or the mouse pans, two fingers pinch. */
  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = null;
    if (adjustHeight && ready && pointers.current.size === 1) {
      // Tapping anywhere on the picture puts the frame there.
      const b = e.currentTarget.getBoundingClientRect();
      const d0 = img();
      commit(clampState({ ...stateRef.current, cx: ((e.clientX - b.left) / b.width) * d0.w, cy: ((e.clientY - b.top) / b.height) * d0.h }, d0, aspect));
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !ready) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointers.current.values());
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinch.current && dist > 0) {
        const b = e.currentTarget.getBoundingClientRect();
        const mid = { x: ((pts[0].x + pts[1].x) / 2 - b.left) / b.width, y: ((pts[0].y + pts[1].y) / 2 - b.top) / b.height };
        commit(zoomBy(stateRef.current, dist / pinch.current, img(), aspect, mid));
      }
      pinch.current = dist;
      return;
    }
    if (adjustHeight) {
      // The stage shows the whole picture, so dragging moves the frame the same way the pointer moves.
      const d0 = img();
      const v = viewSize.current;
      commit(clampState({ ...stateRef.current, cx: stateRef.current.cx + ((e.clientX - prev.x) * d0.w) / v.w, cy: stateRef.current.cy + ((e.clientY - prev.y) * d0.h) / v.h }, d0, aspect));
      return;
    }
    commit(panBy(stateRef.current, e.clientX - prev.x, e.clientY - prev.y, viewSize.current, img(), aspect));
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  }

  if (!mounted) return null;

  const d = img();
  const maxZoom = ready ? maxZoomFor(d, aspect) : 1;
  const rect = ready ? cropRect(state, d, aspect) : null;
  const out = rect ? outputSize(rect, purpose) : null;
  const lowRes = !!rect && Math.min(rect.w, rect.h) < 80;
  const radius = maskRadius(shape);
  const hasMask = radius !== "0";
  const titleId = `${uid}-title`;
  const helpId = `${uid}-help`;
  const zoomId = `${uid}-zoom`;
  const pct = Math.round(state.zoom * 100);
  const small = "min-h-11 min-w-11 inline-flex items-center justify-center rounded-[10px] border border-line bg-surface text-lg font-semibold hover:bg-surface-2 disabled:opacity-50";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" data-testid="cropper-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={helpId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="card flex max-h-[100dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-b-none p-4 text-ink shadow-xl outline-none sm:max-h-[92dvh] sm:rounded-b-[16px] sm:p-5"
      >
        <div>
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <p id={helpId} className="mt-1 text-sm text-muted">
            {adjustHeight
              ? "Drag the white frame (or tap anywhere on the picture) to choose what to keep. Zoom in for a tighter crop. With the picture focused: arrow keys move, plus and minus zoom, Enter confirms, Esc cancels."
              : "Drag the picture to move it. Use the slider, pinch or scroll to zoom. With the picture focused: arrow keys move, plus and minus zoom, Enter confirms, Esc cancels."}
          </p>
        </div>

        {loadError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div
              ref={viewRef}
              role="group"
              tabIndex={ready ? 0 : -1}
              aria-label={`Crop area. Zoom ${pct} percent. Arrow keys move the picture, plus and minus zoom.`}
              data-testid="crop-area"
              onKeyDown={onViewKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={adjustHeight
                ? { aspectRatio: String(d.w / d.h), width: `min(100%, 460px, calc(34dvh * ${d.w / d.h}))`, touchAction: "none", ...checker }
                : { aspectRatio: String(aspect), width: `min(100%, 420px, calc(46dvh * ${aspect}))`, touchAction: "none", ...checker }}
              className={`relative select-none overflow-hidden rounded-[10px] border border-line ${adjustHeight ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
            >
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
              {!ready && <div className="absolute inset-0 grid place-items-center bg-surface text-sm text-muted" role="status">Opening image…</div>}
              {adjustHeight && rect ? (
                /* Frame: the whole picture stays visible and dimmed; the bright window is what the banner keeps. */
                <div
                  aria-hidden="true"
                  data-testid="crop-mask"
                  className="pointer-events-none absolute cursor-move"
                  style={{ left: `${(rect.x / d.w) * 100}%`, top: `${(rect.y / d.h) * 100}%`, width: `${(rect.w / d.w) * 100}%`, height: `${(rect.h / d.h) * 100}%`, boxShadow: "0 0 0 999px rgba(0,0,0,0.6)", outline: "2px solid #fff" }}
                >
                  {["-left-1 -top-1", "-right-1 -top-1", "-left-1 -bottom-1", "-right-1 -bottom-1"].map((p) => (
                    <span key={p} className={`absolute h-2.5 w-2.5 rounded-full border border-black/40 bg-white ${p}`} />
                  ))}
                </div>
              ) : (
                /* Mask: darkens whatever the chosen shape will cut away, then outlines the shape. */
                <div aria-hidden="true" data-testid="crop-mask" className="pointer-events-none absolute inset-0" style={{ borderRadius: radius, boxShadow: hasMask ? "0 0 0 999px rgba(0,0,0,0.55)" : undefined, outline: "2px solid rgba(255,255,255,0.9)", outlineOffset: hasMask ? 0 : -2 }} />
              )}
            </div>

            {adjustHeight && rect && (rect.w / d.w < 0.97 || rect.h / d.h < 0.97) && (
              <div className="w-full max-w-[460px]">
                <p className="mb-1 flex justify-between text-xs font-medium text-muted"><span>Your banner will look like this</span>{out && <span className="tabular-nums">{out.w} × {out.h} px</span>}</p>
                <canvas ref={previewRef} aria-hidden="true" data-testid="crop-preview" className="block w-full rounded-[10px] border border-line shadow-sm" style={{ aspectRatio: String(aspect), ...checker }} />
              </div>
            )}

            {adjustHeight ? (
              <div className="flex w-full max-w-[460px] flex-col gap-3 rounded-[12px] bg-surface-2 p-3">
                <div role="group" aria-label="Banner height" className="grid grid-cols-4 gap-1 rounded-[10px] bg-surface p-1">
                  {([["Slim", 6], ["Standard", 4], ["Wide", 2.5], ["Square", 1]] as const).map(([name, a]) => {
                    const on = Math.abs(aspect - a) < 0.3;
                    return (
                      <button
                        key={name}
                        type="button"
                        disabled={!ready || busy}
                        aria-pressed={on}
                        onClick={() => {
                          aspectRef.current = a;
                          setAspect(a);
                          commit(zoomTo(stateRef.current, stateRef.current.zoom, d, a));
                        }}
                        className={`min-h-9 rounded-[8px] text-sm font-medium transition-colors ${on ? "bg-[var(--accent)] text-[var(--bg)] shadow-sm" : "text-muted hover:text-ink"}`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <label htmlFor={zoomId} className="w-10 text-sm font-medium">Zoom</label>
                  <input
                    id={zoomId}
                    type="range"
                    min={1}
                    max={maxZoom}
                    step={0.01}
                    value={state.zoom}
                    disabled={!ready || maxZoom <= 1}
                    aria-valuetext={`${pct} percent`}
                    onChange={(e) => commit(zoomTo(stateRef.current, Number(e.target.value), d, aspect))}
                    className="range min-w-0 flex-1"
                    style={{ "--fill": `${maxZoom > 1 ? ((state.zoom - 1) / (maxZoom - 1)) * 100 : 0}%` } as React.CSSProperties}
                  />
                  <span className="w-10 text-right text-xs tabular-nums text-muted">{pct}%</span>
                </div>
              </div>
            ) : (
            <div className="flex w-full max-w-[420px] items-center gap-2">
              <button type="button" className={small} aria-label="Zoom out" disabled={!ready || state.zoom <= 1} onClick={() => commit(zoomBy(stateRef.current, 1 / ZOOM_STEP, d, aspect))}>−</button>
              <label htmlFor={zoomId} className="sr-only">Zoom</label>
              <input
                id={zoomId}
                type="range"
                min={1}
                max={maxZoom}
                step={0.01}
                value={state.zoom}
                disabled={!ready || maxZoom <= 1}
                aria-valuetext={`${pct} percent`}
                onChange={(e) => commit(zoomTo(stateRef.current, Number(e.target.value), d, aspect))}
                className="h-11 min-w-0 flex-1 accent-[var(--accent)]"
              />
              <button type="button" className={small} aria-label="Zoom in" disabled={!ready || state.zoom >= maxZoom} onClick={() => commit(zoomBy(stateRef.current, ZOOM_STEP, d, aspect))}>+</button>
            </div>
            )}

            <p role="status" aria-live="polite" className="min-h-5 text-center text-xs text-muted" data-testid="crop-readout">
              {out && !(adjustHeight && rect && (rect.w / d.w < 0.97 || rect.h / d.h < 0.97)) ? `Result: ${out.w} × ${out.h} px.` : ""}
              {lowRes ? " Zoomed in far, so it may look blurry." : ""}
            </p>
          </div>
        )}

        {err && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          {onUseOriginal && <button type="button" className="btn" onClick={onUseOriginal} disabled={busy}>Use the whole image</button>}
          <button type="button" className="btn" disabled={!ready || busy} onClick={() => commit(initialState(d, aspect))}>Reset</button>
          <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void confirm()}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Checkerboard behind the picture so transparent PNGs are visibly transparent. Works in light and dark. */
const checker: React.CSSProperties = {
  backgroundColor: "var(--surface-2)",
  backgroundImage: "linear-gradient(45deg, color-mix(in srgb, var(--border) 60%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--border) 60%, transparent) 75%), linear-gradient(45deg, color-mix(in srgb, var(--border) 60%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--border) 60%, transparent) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 8px 8px",
};
