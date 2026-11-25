"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { getStorage } from "@/lib/editor/draft";
import { editorUrl, readEditorDraft, stageWorkCopy, wouldOverwriteDraft } from "@/lib/polish/editor-bridge";
import type { PolishDetail } from "@/lib/polish/route";
import { isOpen } from "@/lib/polish/status";
import { SignatureDocSchema, type SignatureDoc } from "@/lib/schema/document";
import { OriginPill, SignaturePreview, StatusBadge, When } from "./parts";
import { send, usePolishRequest } from "./use-polish";

const ACTION_LABEL: Record<string, string> = {
  requested: "Requested",
  claimed: "Claimed by a designer",
  released: "Released back to the queue",
  delivered: "Delivered",
  accepted: "Accepted",
  declined: "Declined",
  reopened: "Declined and reopened",
  cancelled: "Cancelled",
};

export function RequestDetail({ id, openEditor = (url) => window.location.assign(url) }: { id: string; openEditor?: (url: string) => void }) {
  const { load, reload } = usePolishRequest(id);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<React.ReactNode>("");

  if (load.state === "loading") return <p role="status" className="card p-6 text-sm text-muted">Loading request…</p>;
  if (load.state === "error") {
    return (
      <p role="alert" className="card p-6 text-sm">
        {load.status === 404 ? "This request does not exist, or you do not have access to it." : load.message}{" "}
        <Link href="/polish" className="underline underline-offset-2">Back to requests</Link>
      </p>
    );
  }
  const d = load.detail;

  /** Run one action: disable the controls, show the server's message on failure, reload on success. */
  async function run(key: string, url: string, body: unknown, done: React.ReactNode = "", then?: (data: Record<string, unknown>) => void) {
    setBusy(key);
    setError("");
    setNotice("");
    const out = await send(url, body);
    if (!out.ok) setError(out.message);
    else {
      setNotice(done);
      then?.(out.data);
      await reload();
    }
    setBusy("");
    return out.ok;
  }

  const open = isOpen(d.status);
  const showPolished = d.deliveredDoc && d.status !== "requested" && d.status !== "in_progress";
  const previous = d.deliveredDoc && (d.status === "requested" || d.status === "in_progress");

  return (
    <div className="space-y-8">
      <div>
        <Link href={d.isRequester || !d.canClaim ? "/polish" : "/polish/queue"} className="text-sm text-muted underline underline-offset-2 hover:text-ink">
          ← Back
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">{d.signatureName}</h2>
          <StatusBadge status={d.status} />
          <OriginPill origin={d.origin} />
          {d.round > 1 && <span className="text-xs text-muted">Round {d.round}</span>}
        </div>
        <p className="mt-1 text-sm text-muted">
          Requested <When iso={d.createdAt} />
        </p>
        <figure className="card mt-4 p-4 sm:p-5">
          <figcaption className="eyebrow mb-2">{d.isRequester ? "Your note to the designer" : "Note from the requester"}</figcaption>
          <blockquote className="whitespace-pre-wrap text-sm">{d.note}</blockquote>
        </figure>
      </div>

      <div aria-live="polite" className="min-h-6 text-sm">
        {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : notice ? <p className="text-muted">{notice}</p> : null}
      </div>

      <section aria-labelledby="compare-h">
        <h3 id="compare-h" className="mb-3 text-lg font-semibold">Compare</h3>
        <div className="grid gap-5 md:grid-cols-2">
          <figure>
            <figcaption className="mb-2 text-sm font-medium">Original <span className="font-normal text-muted">(snapshot when requested)</span></figcaption>
            {d.originalDoc ? <SignaturePreview doc={d.originalDoc} title="Original signature" /> : <Missing>The original could not be shown.</Missing>}
          </figure>
          <figure>
            <figcaption className="mb-2 text-sm font-medium">
              {previous ? "Previous delivery" : "Polished version"}
              {d.status === "accepted" && <span className="font-normal text-muted"> (accepted)</span>}
            </figcaption>
            {showPolished || previous ? (
              <SignaturePreview doc={d.deliveredDoc as SignatureDoc} title={previous ? "Previous polished signature" : "Polished signature"} />
            ) : (
              <Missing>{d.status === "in_progress" ? "The designer is working on it." : d.status === "requested" ? "Waiting for a designer to pick this up." : "Nothing was delivered."}</Missing>
            )}
          </figure>
        </div>
        {d.changeNote && (d.deliveredDoc || d.status === "delivered") && (
          <p className="mt-4 text-sm">
            <span className="font-medium">What changed: </span>
            <span className="whitespace-pre-wrap text-muted">{d.changeNote}</span>
          </p>
        )}
        {d.declineReason && (d.status === "declined" || d.status === "requested") && (
          <p className="mt-2 text-sm">
            <span className="font-medium">Why it was declined: </span>
            <span className="whitespace-pre-wrap text-muted">{d.declineReason}</span>
          </p>
        )}
      </section>

      {d.isRequester && d.status === "delivered" && (
        <ReviewControls d={d} busy={busy} run={run} />
      )}

      {d.canClaim && !d.isRequester && (
        <section aria-labelledby="claim-h" className="card p-4 sm:p-6">
          <h3 id="claim-h" className="font-semibold">Claim this request</h3>
          <p className="mt-1 text-sm text-muted">You will work on a copy in the editor. The requester&apos;s saved signature is never opened or changed.</p>
          <button type="button" className="btn btn-primary mt-4" disabled={busy !== ""} onClick={() => run("claim", `/api/polish/${id}/claim`, {}, "Claimed. It is now yours to polish.")}>
            {busy === "claim" ? "Claiming…" : "Claim request"}
          </button>
        </section>
      )}

      {d.isHolder && d.status === "in_progress" && d.workDoc && (
        <WorkControls d={d} busy={busy} run={run} setError={setError} openEditor={openEditor} />
      )}

      {d.isHolder && d.status === "delivered" && <p className="card p-4 text-sm text-muted sm:p-6">Delivered. Waiting for the requester to accept or decline.</p>}

      {d.isRequester && open && (
        <CancelControl busy={busy} onConfirm={() => run("cancel", `/api/polish/${id}/cancel`, {}, "Request cancelled.")} />
      )}

      {(d.isRequester || d.isHolder) && <Comments d={d} busy={busy} run={run} />}

      <section aria-labelledby="history-h">
        <details className="card">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold sm:px-6" id="history-h">History</summary>
          <ol className="divide-y divide-line border-t border-line text-sm">
            {d.events.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:px-6">
                <span>
                  <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
                  <span className="text-muted"> by {e.by === "requester" ? (d.isRequester ? "you" : "the requester") : e.by === "designer" ? (d.isHolder ? "you" : "a designer") : "the system"}</span>
                </span>
                {e.detail && <span className="whitespace-pre-wrap text-muted">{e.detail}</span>}
                <span className="text-xs text-muted"><When iso={e.createdAt} /></span>
              </li>
            ))}
          </ol>
        </details>
      </section>
    </div>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>;
}

type Run = (key: string, url: string, body: unknown, done?: React.ReactNode, then?: (data: Record<string, unknown>) => void) => Promise<boolean>;

/* ------------------------------------------------------------------ requester: accept or decline */

function ReviewControls({ d, busy, run }: { d: PolishDetail; busy: string; run: Run }) {
  const uid = useId();
  const [mode, setMode] = useState<"new" | "replace">("new");
  const [name, setName] = useState(`${d.signatureName.slice(0, 66)} (polished)`);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [reopen, setReopen] = useState(true);
  const [reasonError, setReasonError] = useState("");

  const base = `/api/polish/${d.id}`;
  const canAccept = mode === "new" ? name.trim().length > 0 : confirm;

  return (
    <section aria-labelledby="review-h" className="grid gap-5 md:grid-cols-2">
      <form
        className="card space-y-4 p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canAccept) return;
          void run("accept", `${base}/accept`, mode === "new" ? { mode, name: name.trim() } : { mode, confirmReplace: true }, mode === "new" ? "Saved as a new signature." : "The original signature now has the polished design.");
        }}
      >
        <h3 id="review-h" className="font-semibold">Accept the polished version</h3>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm text-muted">Save it as</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="radio" name={`${uid}-mode`} checked={mode === "new"} onChange={() => setMode("new")} className="size-4" />
            A new signature (your original stays as it is)
          </label>
          <label className={`flex min-h-11 items-center gap-3 text-sm ${d.hasSource ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
            <input type="radio" name={`${uid}-mode`} checked={mode === "replace"} disabled={!d.hasSource} onChange={() => setMode("replace")} className="size-4" />
            Replace the original signature
          </label>
          {!d.hasSource && <p className="text-xs text-muted">The original was deleted, so it can only be saved as a new signature.</p>}
        </fieldset>
        {mode === "new" ? (
          <div>
            <label htmlFor={`${uid}-name`} className="mb-1 block text-sm text-muted">Name of the new signature</label>
            <input id={`${uid}-name`} className="field w-full" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
        ) : (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 size-4" />
            <span>I understand the original signature will be overwritten with the polished version. This cannot be undone.</span>
          </label>
        )}
        <button type="submit" className="btn btn-primary" disabled={!canAccept || busy !== ""}>
          {busy === "accept" ? "Saving…" : mode === "new" ? "Accept and save as new" : "Accept and replace original"}
        </button>
      </form>

      <form
        className="card space-y-4 p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) {
            setReasonError("Tell the designer what is not right.");
            return;
          }
          setReasonError("");
          void run("decline", `${base}/decline`, { reason: reason.trim(), reopen }, reopen ? "Sent back to the designers with your reason." : "Declined. This request is closed.");
        }}
      >
        <h3 className="font-semibold">Decline</h3>
        <div>
          <label htmlFor={`${uid}-reason`} className="mb-1 block text-sm text-muted">What is not right?</label>
          <textarea id={`${uid}-reason`} className="field w-full py-2" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!reasonError} aria-describedby={reasonError ? `${uid}-reason-err` : undefined} />
          {reasonError && <p id={`${uid}-reason-err`} className="mt-1 text-sm text-red-600 dark:text-red-400">{reasonError}</p>}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} className="size-4" />
          Send it back to the designers for another try
        </label>
        <button type="submit" className="btn" disabled={busy !== ""}>
          {busy === "decline" ? "Sending…" : reopen ? "Decline and reopen" : "Decline and close"}
        </button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ designer: work and deliver */

function WorkControls({ d, busy, run, setError, openEditor }: { d: PolishDetail; busy: string; run: Run; setError: (m: string) => void; openEditor: (url: string) => void }) {
  const [askOverwrite, setAskOverwrite] = useState(false);
  const [askRelease, setAskRelease] = useState(false);
  const [deliver, setDeliver] = useState<SignatureDoc | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const noteId = useId();

  function stage() {
    const storage = getStorage();
    if (!storage || !d.workDoc || !stageWorkCopy(storage, d.workDoc)) {
      setError("This browser would not let us store the copy. Allow site data for this page and try again.");
      return;
    }
    openEditor(editorUrl(d.id));
  }
  function open() {
    const storage = getStorage();
    if (storage && d.workDoc && wouldOverwriteDraft(storage, d.workDoc)) setAskOverwrite(true);
    else stage();
  }
  function reviewDraft() {
    const storage = getStorage();
    const draft = storage ? readEditorDraft(storage) : null;
    const checked = SignatureDocSchema.safeParse(draft);
    if (!checked.success) {
      setError(draft ? "Your editor draft has errors. Open the editor and fix the highlighted fields first." : "There is no draft in the editor yet. Open the copy in the editor first.");
      return;
    }
    setError("");
    setDeliver(checked.data);
  }

  return (
    <section aria-labelledby="work-h" className="card space-y-5 p-4 sm:p-6">
      <div>
        <h3 id="work-h" className="font-semibold">Your work copy</h3>
        <p className="mt-1 text-sm text-muted">
          {d.round > 1 ? "This starts from the last delivery. " : ""}Open the copy in the editor, polish it there, then deliver it. The requester&apos;s saved signature is never touched.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" onClick={open} disabled={busy !== ""}>Open copy in the editor</button>
        <button type="button" className="btn" onClick={reviewDraft} disabled={busy !== ""}>Deliver my editor draft…</button>
        <button type="button" className="btn" onClick={() => setAskRelease(true)} disabled={busy !== ""}>Give it back to the queue</button>
      </div>

      {askOverwrite && (
        <div role="alertdialog" aria-labelledby="ow-h" className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
          <p id="ow-h" className="font-medium">Replace the draft in your editor?</p>
          <p className="mt-1 text-muted">Your editor already holds a different unsaved draft. Opening this copy will replace it.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={stage}>Replace and open</button>
            <button type="button" className="btn" onClick={() => setAskOverwrite(false)}>Keep my draft</button>
          </div>
        </div>
      )}

      {askRelease && (
        <div role="alertdialog" aria-labelledby="rel-h" className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
          <p id="rel-h" className="font-medium">Give this request back to the queue?</p>
          <p className="mt-1 text-muted">Another designer can then claim it. Your work on it is not delivered.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" disabled={busy !== ""} onClick={() => run("release", `/api/polish/${d.id}/release`, {}, "Given back to the queue.")}>
              {busy === "release" ? "Releasing…" : "Give it back"}
            </button>
            <button type="button" className="btn" onClick={() => setAskRelease(false)}>Keep working</button>
          </div>
        </div>
      )}

      {deliver && (
        <form
          className="space-y-4 rounded-xl border border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!changeNote.trim()) {
              setNoteError("Write a short note on what you changed.");
              return;
            }
            setNoteError("");
            void run("deliver", `/api/polish/${d.id}/deliver`, { doc: deliver, changeNote: changeNote.trim() }, "Delivered. The requester can now review it.");
          }}
        >
          <p className="text-sm font-medium">This is the draft that will be delivered</p>
          <SignaturePreview doc={deliver} title="Draft to deliver" />
          <div>
            <label htmlFor={noteId} className="mb-1 block text-sm text-muted">What did you change?</label>
            <textarea id={noteId} className="field w-full py-2" rows={3} maxLength={1000} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} aria-invalid={!!noteError} aria-describedby={noteError ? `${noteId}-err` : undefined} />
            {noteError && <p id={`${noteId}-err`} className="mt-1 text-sm text-red-600 dark:text-red-400">{noteError}</p>}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn btn-primary" disabled={busy !== ""}>{busy === "deliver" ? "Delivering…" : "Deliver to requester"}</button>
            <button type="button" className="btn" onClick={() => setDeliver(null)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ requester: cancel */

function CancelControl({ busy, onConfirm }: { busy: string; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  if (!ask) {
    return (
      <div>
        <button type="button" className="btn" onClick={() => setAsk(true)} disabled={busy !== ""}>Cancel this request</button>
      </div>
    );
  }
  return (
    <div role="alertdialog" aria-labelledby="cancel-h" className="card p-4 text-sm sm:p-6">
      <p id="cancel-h" className="font-medium">Cancel this request?</p>
      <p className="mt-1 text-muted">The designer stops working on it. Your saved signature is not affected.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" disabled={busy !== ""} onClick={onConfirm}>{busy === "cancel" ? "Cancelling…" : "Yes, cancel it"}</button>
        <button type="button" className="btn" onClick={() => setAsk(false)}>Keep it</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ comments */

function Comments({ d, busy, run }: { d: PolishDetail; busy: string; run: Run }) {
  const [text, setText] = useState("");
  const id = useId();
  const canWrite = isOpen(d.status);
  const them = d.isRequester ? "Designer" : "Requester";

  return (
    <section aria-labelledby="comments-h">
      <h3 id="comments-h" className="mb-3 text-lg font-semibold">Comments</h3>
      {d.comments.length === 0 ? (
        <p className="text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {d.comments.map((c) => (
            <li key={c.id} className={`card p-4 text-sm ${c.mine ? "" : "bg-surface-2"}`}>
              <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                <span className="font-medium text-ink">{c.mine ? "You" : c.role === "designer" ? "Designer" : "Requester"}</span>
                <When iso={c.createdAt} />
              </p>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form
          className="mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            if (await run("comment", `/api/polish/${d.id}/comments`, { body: text.trim() }, "Comment sent.")) setText("");
          }}
        >
          <div>
            <label htmlFor={id} className="mb-1 block text-sm text-muted">Message to the {them.toLowerCase()}</label>
            <textarea id={id} className="field w-full py-2" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button type="submit" className="btn" disabled={busy !== "" || !text.trim()}>{busy === "comment" ? "Sending…" : "Send comment"}</button>
        </form>
      )}
    </section>
  );
}
