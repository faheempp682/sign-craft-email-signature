"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { usePolishRequest, send } from "./use-polish";

/**
 * The editor-side banner for a designer polishing a request: shown when the editor URL carries `?polish=<request id>`.
 *
 *   <PolishDeliverBanner requestId={polishId} doc={currentDocument} />
 *
 * It looks the request up itself, shows nothing unless the signed-in person is the designer holding it, and sends
 * POST /api/polish/<id>/deliver { doc, changeNote }. `doc` is the editor's current document (null while it is not ready).
 * The document is validated here and again on the server.
 */
export function PolishDeliverBanner({ requestId, doc, onDelivered }: { requestId: string; doc: SignatureDoc | null; onDelivered?: () => void }) {
  const { load, reload } = usePolishRequest(requestId);
  const [changeNote, setChangeNote] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const id = useId();

  if (load.state === "loading") return null;
  if (load.state === "error") {
    return <p role="alert" className="card mb-4 p-4 text-sm">This polish request is not available to you. <Link href="/polish" className="underline underline-offset-2">Back to requests</Link></p>;
  }
  const d = load.detail;
  if (!d.isHolder) return <p role="alert" className="card mb-4 p-4 text-sm">You are not the designer holding this request. <Link href={`/polish/${d.id}`} className="underline underline-offset-2">Open it</Link></p>;

  if (done || d.status === "delivered") {
    return (
      <p role="status" className="card mb-4 p-4 text-sm">
        Delivered to the requester. <Link href={`/polish/${d.id}`} className="underline underline-offset-2">View the request</Link>
      </p>
    );
  }
  if (d.status !== "in_progress") return <p className="card mb-4 p-4 text-sm text-muted">This request is no longer open for work.</p>;

  async function deliver(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!changeNote.trim()) return setFieldError("Write a short note on what you changed.");
    setFieldError("");
    const checked = SignatureDocSchema.safeParse(doc);
    if (!checked.success) return setError("The signature has errors. Fix the highlighted fields, then deliver.");
    setBusy(true);
    const out = await send(`/api/polish/${requestId}/deliver`, { doc: checked.data, changeNote: changeNote.trim() });
    setBusy(false);
    if (!out.ok) return setError(out.message);
    setDone(true);
    onDelivered?.();
    void reload();
  }

  return (
    <form onSubmit={deliver} aria-labelledby={`${id}-h`} className="card mb-4 space-y-3 p-4 sm:p-5">
      <div>
        <p className="eyebrow mb-1">Designer polish</p>
        <h2 id={`${id}-h`} className="font-semibold">Polishing &ldquo;{d.signatureName}&rdquo;</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm text-muted">Requester&apos;s note: {d.note}</p>
        <p className="mt-1 text-xs text-muted">You are editing a copy. The requester&apos;s saved signature is not changed.</p>
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="mb-1 block text-sm text-muted">What did you change?</label>
        <textarea id={`${id}-note`} className="field w-full py-2" rows={2} maxLength={1000} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} aria-invalid={!!fieldError} aria-describedby={fieldError ? `${id}-err` : undefined} />
        {fieldError && <p id={`${id}-err`} className="mt-1 text-sm text-red-600 dark:text-red-400">{fieldError}</p>}
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy || !doc}>{busy ? "Delivering…" : "Deliver to requester"}</button>
        <Link href={`/polish/${d.id}`} className="btn">View request</Link>
      </div>
    </form>
  );
}
