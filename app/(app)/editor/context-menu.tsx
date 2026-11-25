"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem =
  | { kind?: "item"; label: string; hint?: string; onClick: () => void; disabled?: boolean; danger?: boolean }
  | { kind: "sep" }
  | { kind: "heading"; label: string };

/** Right-click menu. Closes on Escape, outside click, scroll or resize, and stays inside the viewport. */
export function ContextMenu({ x, y, items, onClose, label }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
    };
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    // Clicks inside the (same-origin) preview iframe never reach the page, so listen there too.
    const frames = [...document.querySelectorAll("iframe")].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter((d): d is Document => !!d);
    frames.forEach((d) => d.addEventListener("pointerdown", close, true));
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      frames.forEach((d) => d.removeEventListener("pointerdown", close, true));
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-testid="context-menu"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[70] max-h-[calc(100vh-16px)] w-56 overflow-y-auto rounded-xl border border-line bg-card p-1 text-sm shadow-xl"
      style={pos}
    >
      {items.map((it, i) =>
        it.kind === "sep" ? (
          <div key={i} role="separator" className="my-1 h-px bg-line" />
        ) : it.kind === "heading" ? (
          <p key={i} className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{it.label}</p>
        ) : (
          <button
            key={i}
            role="menuitem"
            type="button"
            disabled={it.disabled}
            onClick={() => { onClose(); it.onClick(); }}
            className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:opacity-35 disabled:hover:bg-transparent ${it.danger ? "text-red-600 dark:text-red-400" : ""}`}
          >
            <span>{it.label}</span>
            {it.hint && <span className="text-[11px] text-muted">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
