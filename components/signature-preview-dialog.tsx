"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mockEmailDocument } from "@/lib/create/mock-email";
import { CLIENTS, CLIENT_IDS, type ClientId } from "@/lib/preview-clients";
import { fitFrameToWidth } from "@/lib/preview-fit";
import { cn } from "@/lib/utils";

/**
 * The signature inside a mock email, in the email client of the customer's choice, with one button to take it to the editor.
 * `html` is our own exporter output; the frame is sandboxed with no scripts at all.
 */
export function SignaturePreviewDialog({ open, onOpenChange, name, html, onChoose, keepLabel = "Keep comparing", chooseLabel = "Choose this signature" }: { open: boolean; onOpenChange: (open: boolean) => void; name: string; html: string; onChoose: () => void; keepLabel?: string; chooseLabel?: string }) {
  const [client, setClient] = useState<ClientId>("gmail");
  const [dark, setDark] = useState(false);
  const c = CLIENTS[client];
  const frame = useRef<HTMLIFrameElement>(null);
  const fit = () => fitFrameToWidth(frame.current);
  useEffect(() => {
    const f = frame.current;
    if (!f || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(f);
    return () => ro.disconnect();
  }, [open, client]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,780px)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 space-y-3 border-b border-line px-4 pb-3 pt-4 pr-12 sm:px-6">
          <DialogHeader>
            <DialogTitle className="truncate">{name}</DialogTitle>
            <DialogDescription className="sr-only">How it looks at the bottom of an email. Pick the email program your customers use.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <div role="group" aria-label="Email client" className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 pb-0.5">
              {CLIENT_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={client === id}
                  onClick={() => setClient(id)}
                  className={cn("min-h-9 shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors duration-150", client === id ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink")}
                >
                  {CLIENTS[id].label}
                </button>
              ))}
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark
            </label>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-surface-2 p-2 sm:p-4">
          <iframe
            title={`${name} in ${c.label}`}
            ref={frame}
            onLoad={fit}
            // allow-same-origin (no scripts) only so the page can measure and scale the content.
            sandbox="allow-same-origin"
            srcDoc={mockEmailDocument(html, client, dark)}
            style={{ width: c.width ?? "100%" }}
            className="mx-auto block h-full max-w-full rounded-lg border border-line bg-white shadow-sm"
          />
        </div>
        <div className="flex shrink-0 flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-muted">
            <span className="font-medium text-ink">{c.badge}.</span> {c.note}
          </p>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <button type="button" className="btn" onClick={() => onOpenChange(false)}>{keepLabel}</button>
            <button type="button" className="btn btn-primary min-h-11" onClick={onChoose}>{chooseLabel}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
