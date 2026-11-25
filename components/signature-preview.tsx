"use client";

import { useEffect, useRef } from "react";

/**
 * Real exporter output on a uniform stage: centred and scaled down (never up) to fit, so every card lines up.
 * `height` is the stage height in px; `className` styles the iframe (the gallery adds a bottom border).
 */
export function SignaturePreview({ title, html, height = 300, lazy = true, className = "" }: { title: string; html: string; height?: number; lazy?: boolean; className?: string }) {
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
      loading={lazy ? "lazy" : undefined}
      srcDoc={`<!doctype html><html><body style="margin:0;height:100vh;background:#f4f4f5;display:flex;align-items:center;justify-content:center;overflow:hidden;"><div id="w">${html}</div></body></html>`}
      style={{ height }}
      className={`pointer-events-none w-full ${className}`}
    />
  );
}
