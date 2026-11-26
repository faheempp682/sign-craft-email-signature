"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { PaletteRoundIcon } from "@solar-icons/react/bold-duotone/palette-round";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/**
 * "Request polish": ask a SignCraft designer to polish a SAVED signature.
 *
 *   <RequestPolish signatureId={saved.id} origin="ai" />      // beside the AI result (after it is saved)
 *   <RequestPolish signatureId={s.id} origin="manual" />       // beside a saved signature
 *
 * `origin` records whether the draft came from AI or was made by hand. With no `signatureId` the button explains that
 * the signature must be saved first. The component renders nothing when the person is signed out or does not have the
 * designer_polish feature (GET /api/polish/status answers 401/403/503), so it can be placed anywhere safely.
 * A snapshot is stored with the request; the saved signature is never changed.
 */
export function RequestPolish({
  signatureId,
  origin,
  className,
  onRequested,
}: {
  signatureId: string | null;
  origin: "ai" | "manual";
  className?: string;
  onRequested?: (requestId: string) => void;
}) {
  const [available, setAvailable] = useState<"checking" | "yes" | "no">("checking");
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    let alive = true;
    setAvailable("checking");
    const url = signatureId ? `/api/polish/status?signatureId=${encodeURIComponent(signatureId)}` : "/api/polish/status";
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) return setAvailable("no");
        const data = (await res.json().catch(() => null)) as { openRequestId?: string | null } | null;
        setOpenId(data?.openRequestId ?? null);
        setAvailable("yes");
      })
      .catch(() => alive && setAvailable("no"));
    return () => {
      alive = false;
    };
  }, [signatureId]);

  if (available !== "yes") return null;

  const existing = sentId ?? openId;
  if (existing) {
    return (
      <p className={cn("inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full bg-accent-soft px-4 text-sm", className)}>
        <PaletteRoundIcon size={16} aria-hidden="true" />
        <span>{sentId ? "Sent to designer" : "Polish requested"}</span>
        <Link href={`/polish/${existing}`} className="font-medium underline underline-offset-2">View request</Link>
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!note.trim()) return setFieldError("Tell the designer what to improve.");
    setFieldError("");
    setBusy(true);
    try {
      const res = await fetch("/api/polish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signatureId, note: note.trim(), origin }) });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok || !data?.id) return setError(data?.message ?? "Could not send the request. Please try again.");
      setSentId(data.id);
      onRequested?.(data.id);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogTrigger asChild>
          <button type="button" className="btn">
            <PaletteRoundIcon size={18} aria-hidden="true" />
            Request polish
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request polish</DialogTitle>
            <DialogDescription>
              {signatureId
                ? "A SignCraft designer will polish a copy of this signature. Your saved signature stays as it is until you accept the result."
                : "Save this signature first, then you can send it to a designer."}
            </DialogDescription>
          </DialogHeader>
          {signatureId && (
            <form onSubmit={submit} className="space-y-3 text-sm">
              <div>
                <label htmlFor={`${id}-note`} className="mb-1 block text-muted">What should the designer improve?</label>
                <textarea
                  id={`${id}-note`}
                  className="field w-full py-2"
                  rows={3}
                  maxLength={1000}
                  placeholder="For example: make the banner stand out"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-invalid={!!fieldError}
                  aria-describedby={fieldError ? `${id}-err` : undefined}
                />
                {fieldError && <p id={`${id}-err`} className="mt-1 text-red-600 dark:text-red-400">{fieldError}</p>}
              </div>
              {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send to a designer"}</button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
