"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shows signature HTML the way a mail app shows it: on a white page, isolated from this site's CSS.
 * The frame is sandboxed with no scripts, no forms and no popups. `allow-same-origin` is only so we can measure
 * the content height; without `allow-scripts` nothing inside can run.
 * On narrow screens the content is zoomed down to fit instead of scrolling sideways.
 */
export function SignatureFrame({ html, title = "Signature preview", minHeight = 140 }: { html: string; title?: string; minHeight?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);

  const fit = useCallback(() => {
    try {
      const frame = ref.current;
      const doc = frame?.contentDocument;
      if (!frame || !doc?.body) return;
      doc.body.style.zoom = "1";
      const avail = frame.clientWidth;
      const need = doc.body.scrollWidth;
      if (avail > 0 && need > avail) doc.body.style.zoom = String(avail / need);
      setHeight(Math.max(minHeight, Math.ceil(doc.documentElement.scrollHeight)));
    } catch {
      /* Not measurable (for example in a test DOM): keep the minimum height. */
    }
  }, [minHeight]);

  // Images change the height when they arrive, so measure again then.
  const onLoad = useCallback(() => {
    fit();
    try {
      ref.current?.contentDocument?.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit));
    } catch {
      /* not measurable */
    }
  }, [fit]);

  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}body{padding:16px;font-family:Arial,Helvetica,sans-serif}</style></head><body>${html}</body></html>`;
  return <iframe ref={ref} title={title} sandbox="allow-same-origin" srcDoc={doc} onLoad={onLoad} style={{ width: "100%", height, border: 0, display: "block", background: "#fff" }} />;
}
