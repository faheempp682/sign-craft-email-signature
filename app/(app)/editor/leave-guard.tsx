"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Catches in-app navigation (any same-origin link click) while `activeRef.current` is true, and hands the target to the
 * caller so it can ask "save, keep as draft, or discard?" before going. Tab close / refresh cannot show a custom dialog,
 * so `warnOnUnload` turns on the browser's own prompt for work that has nowhere else to go.
 */
export function useLeaveGuard(activeRef: MutableRefObject<boolean>, warnOnUnload: boolean) {
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!activeRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!warnOnUnload || !activeRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // Capture phase, so this runs before Next's <Link> handler and can stop it.
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [activeRef, warnOnUnload]);

  return { pending, setPending };
}

export function LeaveDialog({ open, canSave, canDraft, busy, message, onSave, onDraft, onDiscard, onCancel }: {
  open: boolean;
  canSave: boolean;
  canDraft: boolean;
  busy: boolean;
  message?: string;
  onSave: () => void;
  onDraft: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave without saving?</DialogTitle>
          <DialogDescription>{canDraft ? "Keep your work as a draft and come back to it any time." : "You have changes that are not saved yet."}</DialogDescription>
        </DialogHeader>
        {message && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{message}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {canDraft ? (
            // New signature: stay, or keep it as a draft. Nothing is lost either way.
            <>
              <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={onDraft} disabled={busy}>Save as draft</button>
            </>
          ) : (
            // Saved signature: leave without the changes, or save them. Cancel is the X / Esc.
            <>
              <button className="btn" onClick={onDiscard} disabled={busy}>Discard changes</button>
              {canSave && <button className="btn btn-primary" onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save"}</button>}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
