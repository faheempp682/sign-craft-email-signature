"use client";

import { useCallback, useEffect, useState } from "react";
import { call, Field, formatDate, Status, useAction } from "../api";
import { Pill } from "../deploy/ui";
import { RestorePanel } from "./restore-panel";
import { KIND_LABEL, RESOLVED_LABEL, STATUS_LABEL, type Finding, type FindingsPage } from "./types";

const STATUS_FILTERS = [
  { id: "open", label: "Open" },
  { id: "acknowledged", label: "Acknowledged" },
  { id: "resolved", label: "Resolved" },
  { id: "", label: "All" },
] as const;
const KIND_FILTERS = [
  { id: "", label: "Edited and removed" },
  { id: "edited", label: "Edited" },
  { id: "removed", label: "Removed" },
] as const;

export function FindingsSection({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const [status, setStatus] = useState<string>("open");
  const [kind, setKind] = useState<string>("");
  const [items, setItems] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [restoring, setRestoring] = useState<Finding[] | null>(null);
  const { busy, error, notice, run } = useAction();

  const load = useCallback(
    async (p: number, replace: boolean) => {
      setLoading(true);
      const q = new URLSearchParams({ page: String(p) });
      if (status) q.set("status", status);
      if (kind) q.set("kind", kind);
      const r = await call<FindingsPage>("GET", `/api/health/findings?${q}`);
      setLoading(false);
      if (!r.ok) return setLoadError(r.message);
      setLoadError("");
      setItems((prev) => (replace ? r.data.items : [...prev, ...r.data.items]));
      setTotal(r.data.total);
      setPage(p);
    },
    [status, kind],
  );
  useEffect(() => {
    setPicked(new Set());
    load(0, true);
  }, [load, reloadKey]);

  async function acknowledge(f: Finding) {
    setNoteError("");
    if (!note.trim()) return setNoteError("Add a short note saying why.");
    const r = await run("ack", () => call("POST", `/api/health/findings/${f.id}/acknowledge`, { note: note.trim() }), "Acknowledged.");
    if (r.ok) {
      setAckFor(null);
      setNote("");
      await load(0, true);
      onChanged();
    }
  }

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const restorable = items.filter((f) => f.status !== "resolved");
  const chosen = items.filter((f) => picked.has(f.id));

  return (
    <section aria-labelledby="f-h" className="space-y-4">
      <h2 id="f-h" className="text-lg font-semibold">Findings</h2>
      <p className="max-w-3xl text-sm text-muted">One finding per person. It stays open until the signature in Gmail matches again (it then resolves by itself) or you acknowledge it with a note. Nothing here changes anyone&apos;s signature unless you review and confirm a restore.</p>

      <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="f-status" label="Status">
          <select id="f-status" className="field min-h-11 w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </Field>
        <Field id="f-kind" label="What happened">
          <select id="f-kind" className="field min-h-11 w-full" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_FILTERS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Status error={error} notice={notice} />
      {loadError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}

      {restoring && <RestorePanel people={restoring} onClose={() => setRestoring(null)} onDone={() => { setRestoring(null); load(0, true); onChanged(); }} />}

      {!restoring && restorable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn min-h-11" disabled={chosen.length === 0} onClick={() => setRestoring(chosen)}>
            Restore selected ({chosen.length})
          </button>
          <button type="button" className="btn min-h-11" onClick={() => setPicked(new Set(restorable.map((f) => f.id)))}>Select all shown</button>
          {picked.size > 0 && <button type="button" className="btn min-h-11" onClick={() => setPicked(new Set())}>Clear selection</button>}
        </div>
      )}

      {loading && items.length === 0 ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">{status === "open" ? "No open findings. Everyone checked has the signature SignCraft deployed." : "Nothing to show for this filter."}</p>
      ) : (
        <ul className="space-y-3" aria-label="Findings">
          {items.map((f) => (
            <li key={f.id} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-start gap-3">
                {f.status !== "resolved" && (
                  <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                    <input type="checkbox" className="size-5" checked={picked.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Select ${f.person_name || f.email} for restore`} />
                  </label>
                )}
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">{f.person_name || f.email}</p>
                  <p className="break-all text-sm text-muted">{f.email}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Pill tone={f.kind === "removed" ? "bad" : "warn"}>{KIND_LABEL[f.kind]}</Pill>
                  <Pill tone={f.status === "open" ? "bad" : f.status === "resolved" ? "good" : "plain"}>{STATUS_LABEL[f.status]}</Pill>
                </div>
              </div>
              <p className="text-sm text-muted">
                Found {formatDate(f.opened_at)}. {f.detail}
                {f.status === "resolved" && f.resolved_at ? ` Resolved ${formatDate(f.resolved_at)}: ${RESOLVED_LABEL[f.resolved_reason] ?? "closed"}.` : ""}
              </p>
              {f.status === "acknowledged" && <p className="text-sm">Acknowledged{f.acknowledged_at ? ` ${formatDate(f.acknowledged_at)}` : ""}. Note: {f.ack_note}</p>}
              {f.status !== "resolved" && (
                <div className="flex flex-wrap gap-2">
                  {f.status === "open" && (
                    <button type="button" className="btn min-h-11" aria-expanded={ackFor === f.id} onClick={() => { setAckFor(ackFor === f.id ? null : f.id); setNote(""); setNoteError(""); }}>
                      Acknowledge
                    </button>
                  )}
                  <button type="button" className="btn min-h-11" onClick={() => setRestoring([f])}>Restore the approved signature</button>
                </div>
              )}
              {ackFor === f.id && (
                <div className="max-w-xl space-y-3 rounded-lg border border-line p-3">
                  <Field id={`n-${f.id}`} label="Why is this fine? (saved with your name)" error={noteError}>
                    <input id={`n-${f.id}`} className="field w-full" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={!!noteError} aria-describedby={noteError ? `n-${f.id}-err` : undefined} />
                  </Field>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-primary min-h-11" disabled={busy === "ack"} onClick={() => acknowledge(f)}>{busy === "ack" ? "Saving…" : "Save acknowledgement"}</button>
                    <button type="button" className="btn min-h-11" onClick={() => setAckFor(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length < total && (
        <button type="button" className="btn min-h-11" disabled={loading} onClick={() => load(page + 1, false)}>
          Show more ({(total - items.length).toLocaleString("en-GB")} left)
        </button>
      )}
    </section>
  );
}
