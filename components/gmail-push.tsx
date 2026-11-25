"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SignatureDoc } from "@/lib/schema/document";

/**
 * "Send to Gmail". Nothing is ever replaced without the person seeing and approving it:
 *   pick an address -> Review (shows the address, the NEW signature and the CURRENT one) -> tick the box -> Replace.
 * The server re-checks that what it writes is exactly what was previewed. Google tokens never reach this component.
 */

type Status = { configured: boolean; connected: boolean; email?: string | null; domain?: string | null };
type Address = { email: string; displayName: string; isPrimary: boolean; isDefault: boolean; hasSignature: boolean; canEdit: boolean };
type Preview = {
  address: { email: string; displayName: string; isPrimary: boolean };
  newHtml: string;
  newHash: string;
  newLength: number;
  limit: number;
  tooLong: boolean;
  current: { html: string; hash: string; hasSignature: boolean };
};
type ApiError = { error?: string; message?: string };

/** Short outcome codes the connect flow puts in the address (`?gmail=...`) after coming back from Google. */
const OUTCOMES: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Google account connected." },
  denied: { tone: "bad", text: "Google sign-in was cancelled. Nothing was connected." },
  admin_blocked: { tone: "bad", text: "Your Workspace admin has blocked this app. Ask them to allow it (see docs/gmail-push.md)." },
  wrong_account: { tone: "bad", text: "That Google account is not in your company's Workspace. Connect with your work account." },
  scope_missing: { tone: "bad", text: "Signature access was not allowed. Connect again and tick every permission." },
  no_refresh_token: { tone: "bad", text: "Google did not finish setting up the connection. Please try again." },
  expired: { tone: "bad", text: "That sign-in expired. Please try connecting again." },
  reconnect_required: { tone: "bad", text: "That sign-in expired. Please try connecting again." },
  not_configured: { tone: "bad", text: "Gmail push is not set up on the server yet." },
  feature_disabled: { tone: "bad", text: "Gmail push is not enabled for your account." },
  upstream: { tone: "bad", text: "Google had a problem. Please try again in a moment." },
  error: { tone: "bad", text: "Something went wrong connecting to Google. Please try again." },
};

/** Wraps signature HTML for the preview frames. Scripts are blocked by the frame's sandbox. */
const frameDoc = (html: string) => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;background:#fff">${html}</body></html>`;

export function GmailPush({ doc, returnTo }: { doc: SignatureDoc | null; returnTo: string }) {
  const [status, setStatus] = useState<Status | "loading" | "hidden">("loading");
  const [outcome, setOutcome] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<"" | "addresses" | "preview" | "push" | "disconnect">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ email: string; logged: boolean } | null>(null);
  const [disconnected, setDisconnected] = useState("");
  const doneRef = useRef<HTMLHeadingElement>(null);

  const docKey = useMemo(() => (doc ? JSON.stringify(doc) : ""), [doc]);

  /** One place to read an API answer. Revoked or missing connections flip the panel back to "Connect". */
  const call = useCallback(async <T,>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> => {
    try {
      const res = await fetch(url, init);
      const data = (await res.json().catch(() => ({}))) as T & ApiError;
      if (res.ok) return { ok: true, data };
      if (data.error === "reconnect_required" || data.error === "not_connected") {
        setStatus((s) => (typeof s === "object" ? { ...s, connected: false, email: null } : s));
        setAddresses(null);
        setPreview(null);
      }
      return { ok: false, error: data };
    } catch {
      return { ok: false, error: { error: "network", message: "Could not reach the server. Check your connection and try again." } };
    }
  }, []);

  // Initial status, plus the outcome of a Connect round trip (?gmail=...), which is then removed from the address bar.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("gmail");
    if (code) {
      setOutcome(OUTCOMES[code] ?? OUTCOMES.error);
      url.searchParams.delete("gmail");
      window.history.replaceState(null, "", url.toString());
    }
    let alive = true;
    void (async () => {
      const r = await call<Status>("/api/google/status");
      if (!alive) return;
      // Signed out, switched off for this person, or no accounts at all: show nothing rather than a dead end.
      if (!r.ok) return setStatus("hidden");
      setStatus(r.data);
    })();
    return () => {
      alive = false;
    };
  }, [call]);

  // The signature changed since it was previewed, so the preview no longer describes what would be sent.
  useEffect(() => {
    if (preview && previewKey !== docKey) {
      setPreview(null);
      setAgreed(false);
      setError("The signature changed, so the preview was cleared. Review it again.");
    }
  }, [docKey, preview, previewKey]);

  async function loadAddresses() {
    setBusy("addresses");
    setError("");
    const r = await call<{ addresses: Address[] }>("/api/google/sendas");
    setBusy("");
    if (!r.ok) return setError(r.error.message ?? "Could not load your addresses.");
    setAddresses(r.data.addresses);
    const first = r.data.addresses.find((a) => a.canEdit);
    setChosen(first?.email ?? "");
  }

  async function review() {
    if (!doc || !chosen) return;
    setBusy("preview");
    setError("");
    setAgreed(false);
    const r = await call<Preview>("/api/google/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc, email: chosen }) });
    setBusy("");
    if (!r.ok) return setError(r.error.message ?? "Could not prepare the preview.");
    setPreview(r.data);
    setPreviewKey(docKey);
  }

  async function replace() {
    if (!doc || !preview || !agreed) return;
    setBusy("push");
    setError("");
    const r = await call<{ email: string; logged: boolean }>("/api/google/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Exactly what was reviewed: the person's confirmation (the checkbox) and both fingerprints. The server refuses if either side has changed.
      body: JSON.stringify({ doc, email: preview.address.email, confirm: agreed, newHash: preview.newHash, currentHash: preview.current.hash }),
    });
    setBusy("");
    if (!r.ok) {
      setPreview(null);
      setAgreed(false);
      return setError(r.error.message ?? "Gmail was not updated.");
    }
    setDone({ email: r.data.email, logged: r.data.logged });
    setPreview(null);
    setAgreed(false);
    setTimeout(() => doneRef.current?.focus(), 0);
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    const r = await call<{ revoked: string }>("/api/google/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setBusy("");
    if (!r.ok) return setError(r.error.message ?? "Could not disconnect. Please try again.");
    setStatus((s) => (typeof s === "object" ? { ...s, connected: false, email: null } : s));
    setAddresses(null);
    setPreview(null);
    setDone(null);
    setOutcome(null);
    setDisconnected(
      r.data.revoked === "failed"
        ? "Disconnected here, but Google did not confirm the revocation. To be sure, remove SignCraft at myaccount.google.com/permissions."
        : "Disconnected. Google access was cancelled and the saved connection was deleted.",
    );
  }

  if (status === "loading" || status === "hidden") return null;

  const connectHref = `/api/google/connect?next=${encodeURIComponent(returnTo)}`;
  const target = addresses?.find((a) => a.email === chosen);

  return (
    <section aria-labelledby="gmail-h" className="card mt-4 space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="gmail-h" className="text-base font-semibold">Send to Gmail</h2>
          <p className="mt-1 text-sm text-muted">Put this signature into your Google Workspace Gmail in one step. You review it before anything changes.</p>
        </div>
        {status.connected && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">Connected as <strong className="font-medium text-ink">{status.email}</strong></span>
            <button type="button" className="btn min-h-11" onClick={disconnect} disabled={busy === "disconnect"}>
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        )}
      </div>

      <div aria-live="polite" className="space-y-2 text-sm">
        {outcome && <p className={outcome.tone === "ok" ? "text-ink" : "text-red-600 dark:text-red-400"}>{outcome.text}</p>}
        {disconnected && <p>{disconnected}</p>}
        {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {!status.configured && <p className="text-sm text-muted">Gmail push is not set up on this server yet. Ask an admin (setup steps are in docs/gmail-push.md).</p>}

      {status.configured && !status.connected && (
        <div>
          <a href={connectHref} className="btn btn-primary inline-flex min-h-11 items-center">Connect Google account</a>
          <p className="mt-2 text-xs text-muted">You will be asked to allow SignCraft to change your Gmail signature settings. It cannot read your email. You can disconnect at any time.</p>
        </div>
      )}

      {status.configured && status.connected && !done && (
        <div className="space-y-4">
          {!addresses && (
            <button type="button" className="btn btn-primary min-h-11" onClick={loadAddresses} disabled={!doc || busy === "addresses"}>
              {busy === "addresses" ? "Loading your addresses…" : "Choose address"}
            </button>
          )}
          {!doc && <p className="text-sm text-muted">Fix the highlighted fields first, then you can send the signature.</p>}

          {addresses && (
            <fieldset className="space-y-2" disabled={busy !== ""}>
              <legend className="text-sm font-medium">Which address should get this signature?</legend>
              {addresses.map((a) => (
                <label key={a.email} className={`flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm ${a.canEdit ? "cursor-pointer border-line" : "cursor-not-allowed border-line opacity-60"}`}>
                  <input
                    type="radio"
                    name="gmail-address"
                    className="mt-1"
                    value={a.email}
                    checked={chosen === a.email}
                    disabled={!a.canEdit}
                    onChange={() => {
                      setChosen(a.email);
                      setPreview(null);
                      setAgreed(false);
                    }}
                  />
                  <span>
                    <span className="font-medium">{a.email}</span>
                    {a.isPrimary && <span className="ml-2 text-xs text-muted">primary</span>}
                    <span className="block text-xs text-muted">
                      {a.displayName && `${a.displayName} · `}
                      {!a.canEdit ? "Not verified in Gmail yet, so it cannot be changed" : a.hasSignature ? "Has a signature (it would be replaced)" : "No signature yet"}
                    </span>
                  </span>
                </label>
              ))}
              {addresses.length === 0 && <p className="text-sm text-muted">No send-as addresses were found on this account.</p>}
              <button type="button" className="btn btn-primary min-h-11" onClick={review} disabled={!doc || !target?.canEdit || busy !== ""}>
                {busy === "preview" ? "Preparing the preview…" : "Review before sending"}
              </button>
            </fieldset>
          )}

          {preview && (
            <div className="space-y-4 rounded-xl border border-line p-4" role="group" aria-label="Review before replacing">
              <p className="text-sm">
                You are about to update the signature for <strong className="font-semibold">{preview.address.email}</strong>
                {preview.address.displayName && <> ({preview.address.displayName})</>}.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-sm font-medium">New signature</h3>
                  <iframe title="New signature" sandbox="" srcDoc={frameDoc(preview.newHtml)} className="h-56 w-full rounded-lg border border-line bg-white" />
                  <p className={`mt-1 text-xs ${preview.tooLong ? "text-red-600 dark:text-red-400" : "text-muted"}`}>
                    {preview.newLength.toLocaleString("en-US")} of {preview.limit.toLocaleString("en-US")} characters Gmail allows
                    {preview.tooLong && ". Too long: shorten the disclaimer or choose a simpler template."}
                  </p>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium">{preview.current.hasSignature ? "Current signature (will be replaced)" : "Current signature"}</h3>
                  {preview.current.hasSignature ? (
                    <iframe title="Current signature" sandbox="" srcDoc={frameDoc(preview.current.html)} className="h-56 w-full rounded-lg border border-line bg-white" />
                  ) : (
                    <p className="grid h-56 place-items-center rounded-lg border border-dashed border-line text-sm text-muted">No signature is set on this address.</p>
                  )}
                </div>
              </div>

              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={preview.tooLong || busy !== ""} />
                <span>
                  {preview.current.hasSignature
                    ? `I have looked at both, and I want to replace the current signature on ${preview.address.email}.`
                    : `I have looked at the new signature and I want to set it on ${preview.address.email}.`}
                </span>
              </label>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary min-h-11" onClick={replace} disabled={!agreed || preview.tooLong || busy !== ""}>
                  {busy === "push" ? "Updating Gmail…" : `Replace signature on ${preview.address.email}`}
                </button>
                <button
                  type="button"
                  className="btn min-h-11"
                  disabled={busy !== ""}
                  onClick={() => {
                    setPreview(null);
                    setAgreed(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {done && (
        <div className="rounded-xl border border-line p-4 text-sm">
          <h3 ref={doneRef} tabIndex={-1} className="font-semibold outline-none">Signature updated for {done.email}</h3>
          <p className="mt-1 text-muted">
            Open Gmail and start a new email to check it. The signature that was there before has been saved{done.logged ? "" : " (the backup could not be recorded this time)"}.
          </p>
          <button type="button" className="btn mt-3 min-h-11" onClick={() => setDone(null)}>Done</button>
        </div>
      )}
    </section>
  );
}
