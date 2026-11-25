"use client";

import { useCallback, useEffect, useState } from "react";
import { specFromSnapshot } from "@/lib/team/render";
import { lockableFields, type TemplateSpec } from "@/lib/team/template";
import { call, formatDate, Status, useAction } from "./api";
import { PersonPreview } from "./preview";

type PersonLite = { id: string; email: string; full_name: string; title: string; department: string; phone: string; mobile: string; location: string; custom: Record<string, string> };
type Version = {
  id: string;
  version_no: number;
  status: "pending" | "approved" | "rejected" | "draft";
  values_json: Record<string, string>;
  template_snapshot: unknown;
  created_at: string;
  reviewed_at: string | null;
  review_note: string;
  people: PersonLite | null;
};

/** Human labels for the submitted values: "Identity · Job title: Chief Wizard". */
function describe(spec: TemplateSpec | null, values: Record<string, string>) {
  if (!spec) return Object.entries(values).map(([k, v]) => ({ key: k, label: k, value: v }));
  const fields = new Map(lockableFields(spec.doc).map((f) => [f.key, f]));
  return Object.entries(values).map(([k, v]) => ({ key: k, label: fields.get(k) ? `${fields.get(k)!.rule.label}` : k, value: v }));
}

export function ApprovalsTab({ onChanged }: { onChanged?: () => void }) {
  const [pending, setPending] = useState<Version[] | null>(null);
  const [decided, setDecided] = useState<Version[]>([]);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    const [p, d] = await Promise.all([call<{ versions: Version[] }>("GET", "/api/team/approvals?status=pending"), call<{ versions: Version[] }>("GET", "/api/team/approvals?status=all")]);
    if (p.ok) {
      setPending(p.data.versions);
      setLoadError("");
    } else setLoadError(p.message);
    if (d.ok) setDecided(d.data.versions.filter((v) => v.status === "approved" || v.status === "rejected").slice(0, 15));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      <section aria-labelledby="q-h" className="space-y-4">
        <h2 id="q-h" className="text-lg font-semibold">Waiting for review</h2>
        <p className="max-w-2xl text-sm text-muted">The approved version is the one that is deployed. People keep using their last approved signature until you approve the change.</p>
        {loadError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
        {pending?.length === 0 && <p className="card p-6 text-sm text-muted">Nothing is waiting. When an organization requires approval, employee changes show up here.</p>}
        {pending?.map((v) => <PendingCard key={v.id} v={v} onDecided={() => { load(); onChanged?.(); }} />)}
      </section>

      <section aria-labelledby="h-h" className="space-y-3">
        <h2 id="h-h" className="text-lg font-semibold">Recent decisions</h2>
        {decided.length === 0 && <p className="text-sm text-muted">No decisions yet.</p>}
        <ul className="divide-y divide-line rounded-2xl border border-line text-sm">
          {decided.map((v) => (
            <li key={v.id} className="space-y-1 p-3">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{v.people?.full_name ?? "Removed person"} <span className="font-normal text-muted">version {v.version_no}</span></span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${v.status === "rejected" ? "border-red-600 text-red-600 dark:border-red-400 dark:text-red-400" : "border-line"}`}>{v.status === "approved" ? "Approved" : "Rejected"}</span>
              </p>
              <p className="text-muted">{v.reviewed_at ? formatDate(v.reviewed_at) : ""}{v.review_note ? ` · ${v.review_note}` : ""}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PendingCard({ v, onDecided }: { v: Version; onDecided: () => void }) {
  const { busy, error, run } = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const spec = specFromSnapshot(v.template_snapshot);
  const changes = describe(spec, v.values_json);

  async function decide(decision: "approve" | "reject") {
    if (decision === "reject" && !note.trim()) return setNoteError("Tell them why, so they can fix it.");
    setNoteError("");
    const r = await run(decision, () => call("POST", `/api/team/approvals/${v.id}`, { decision, note: note.trim() }));
    if (r.ok) onDecided();
  }

  return (
    <article className="card space-y-4 p-4 sm:p-6" aria-label={`Change by ${v.people?.full_name ?? "a removed person"}`}>
      <div>
        <h3 className="font-semibold">{v.people?.full_name ?? "Removed person"}</h3>
        <p className="text-sm text-muted">{v.people?.email} · submitted {formatDate(v.created_at)}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold">What they changed</h4>
          {changes.length === 0 ? <p className="text-sm text-muted">No fields were changed from the directory values.</p> : (
            <dl className="space-y-2 text-sm">
              {changes.map((c) => (
                <div key={c.key} className="rounded-lg border border-line p-2.5"><dt className="text-muted">{c.label}</dt><dd className="break-words font-medium">{c.value || "(cleared)"}</dd></div>
              ))}
            </dl>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">How it will look</h4>
          {spec && v.people ? <PersonPreview spec={spec} person={v.people} values={v.values_json} title={`Signature of ${v.people.full_name}`} /> : <p className="text-sm text-muted">No preview available.</p>}
        </div>
      </div>
      {rejecting && (
        <div>
          <label htmlFor={`note-${v.id}`} className="mb-1 block text-sm text-muted">Reason (the employee sees this)</label>
          <textarea id={`note-${v.id}`} className="field w-full py-2" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!noteError} aria-describedby={noteError ? `note-${v.id}-err` : undefined} />
          {noteError && <p id={`note-${v.id}-err`} className="mt-1 text-sm text-red-600 dark:text-red-400">{noteError}</p>}
        </div>
      )}
      <Status error={error} notice="" />
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => decide("approve")}>{busy === "approve" ? "Approving…" : "Approve"}</button>
        {rejecting ? (
          <>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => decide("reject")}>{busy === "reject" ? "Rejecting…" : "Confirm rejection"}</button>
            <button type="button" className="btn" onClick={() => { setRejecting(false); setNoteError(""); }}>Cancel</button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setRejecting(true)}>Reject</button>
        )}
      </div>
    </article>
  );
}
