"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mockEmailDocument } from "@/lib/create/mock-email";
import { CLIENTS, CLIENT_IDS, type ClientId } from "@/lib/preview-clients";
import { cn } from "@/lib/utils";

/**
 * The signature inside a mock email, in the email client of the customer's choice, with one button to take it to the editor.
 * `html` is our own exporter output; the frame is sandboxed with no scripts at all.
 */
export function SignaturePreviewDialog({ open, onOpenChange, name, html, onChoose }: { open: boolean; onOpenChange: (open: boolean) => void; name: string; html: string; onChoose: () => void }) {
  const [client, setClient] = useState<ClientId>("gmail");
  const [dark, setDark] = useState(false);
  const c = CLIENTS[client];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>How it looks at the bottom of an email. Pick the email program your customers use.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Email client" className="flex flex-wrap gap-1">
            {CLIENT_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={client === id}
                onClick={() => setClient(id)}
                className={cn("min-h-9 cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors duration-150", client === id ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink")}
              >
                {CLIENTS[id].label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark mode
          </label>
        </div>
        <div className="rounded-lg border border-line bg-surface-2 p-0 sm:p-3">
          <iframe
            title={`${name} in ${c.label}`}
            sandbox=""
            srcDoc={mockEmailDocument(html, client, dark)}
            style={{ width: c.width ?? "100%" }}
            className="mx-auto block h-[500px] max-w-full rounded-md border border-line bg-white"
          />
        </div>
        <p className="text-xs text-muted">
          {c.badge}. {c.note}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>Keep comparing</button>
          <button type="button" className="btn btn-primary min-h-11" onClick={onChoose}>Choose this signature</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
