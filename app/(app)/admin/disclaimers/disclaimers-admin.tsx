"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CATEGORY_LABEL, REVIEW_NOTE, type Disclaimer } from "@/lib/disclaimers/labels";
import { Status, useSave } from "../use-save";
import { Select } from "@/components/ui/select";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as Disclaimer["category"][];

export function DisclaimersAdmin({ items }: { items: Disclaimer[] }) {
  const { busy, error, notice, save } = useSave();
  const [filter, setFilter] = useState<"all" | Disclaimer["category"]>("all");
  const router = useRouter();
  const [copying, setCopying] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState("");

  /** Copies a starting point into the organization's own list (still flagged as needing review). */
  async function copy(d: Disclaimer) {
    setCopying(d.id);
    setCopyMsg("");
    try {
      const res = await fetch("/api/disclaimers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: d.title, category: d.category, jurisdiction: d.jurisdiction, body: d.body, needs_review: true }) });
      if (res.ok) {
        setCopyMsg(`${d.title} copied to your list.`);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setCopyMsg(data?.message ?? "That did not work. Please try again.");
      }
    } catch {
      setCopyMsg("Could not reach the server. Check your connection and try again.");
    } finally {
      setCopying(null);
    }
  }

  const shown = items.filter((d) => filter === "all" || d.category === filter);
  const own = shown.filter((d) => d.org_id !== null);
  const global = shown.filter((d) => d.org_id === null);

  return (
    <div className="space-y-10">
      <Status error={error} notice={notice || copyMsg} />
      <p role="note" className="card border-l-4 p-4 text-sm">{REVIEW_NOTE} The wording below is neutral boilerplate. Copy one to your own list to edit it; your copies stay marked until you confirm a lawyer has approved them.</p>

      <div className="max-w-xs">
        <label htmlFor="cat" className="mb-1 block text-sm text-muted">Show</label>
        <Select id="cat" className="field min-h-11 w-full" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </Select>
      </div>

      <NewDisclaimer />

      <section aria-labelledby="own-h" className="space-y-4">
        <h2 id="own-h" className="text-lg font-semibold">Your organization&apos;s disclaimers</h2>
        {own.length === 0 && <p className="text-sm text-muted">None yet. Add your own above, or copy a starting point below.</p>}
        {own.map((d) => <OwnItem key={`${d.id}:${d.body}:${d.title}`} d={d} busy={busy} save={save} />)}
      </section>

      <section aria-labelledby="global-h" className="space-y-4">
        <h2 id="global-h" className="text-lg font-semibold">Starting points</h2>
        {global.map((d) => (
          <article key={d.id} className="card space-y-2 p-4 sm:p-6" aria-labelledby={`g-${d.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`g-${d.id}`} className="font-medium">{d.title}</h3>
              <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs">{CATEGORY_LABEL[d.category]}</span>
              {d.jurisdiction && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs">{d.jurisdiction}</span>}
              <span className="rounded-full border border-line px-2.5 py-0.5 text-xs">Needs legal review</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-muted">{d.body}</p>
            <button
              type="button"
              className="btn min-h-11"
              disabled={copying === d.id}
              onClick={() => void copy(d)}
            >
              Copy to my list
            </button>
          </article>
        ))}
        {global.length === 0 && <p className="text-sm text-muted">Nothing in this category.</p>}
      </section>
    </div>
  );
}

function NewDisclaimer() {
  const router = useRouter();
  const [f, setF] = useState({ title: "", category: "confidentiality" as Disclaimer["category"], jurisdiction: "", body: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!f.title.trim()) next.title = "Give it a title.";
    if (!f.body.trim()) next.body = "Enter the text.";
    else if (f.body.length > 1500) next.body = "Keep it to 1,500 characters or fewer.";
    setErrs(next);
    if (Object.keys(next).length) return;
    setSending(true);
    setFormError("");
    try {
      const res = await fetch("/api/disclaimers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, title: f.title.trim(), body: f.body.trim(), needs_review: true }) });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setFormError(data?.message ?? "That did not work. Please try again.");
        return;
      }
      setF({ ...f, title: "", body: "", jurisdiction: "" });
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-4 sm:p-6" noValidate aria-labelledby="nd-h">
      <h2 id="nd-h" className="text-lg font-semibold">Add your own</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label htmlFor="nd-title" className="mb-1 block text-sm text-muted">Title</label>
          <input id="nd-title" className="field min-h-11 w-full" value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} aria-invalid={!!errs.title} aria-describedby={errs.title ? "nd-title-err" : undefined} />
          {errs.title && <p id="nd-title-err" className="mt-1 text-sm text-red-600 dark:text-red-400">{errs.title}</p>}
        </div>
        <div>
          <label htmlFor="nd-cat" className="mb-1 block text-sm text-muted">Category</label>
          <Select id="nd-cat" className="field min-h-11 w-full" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Disclaimer["category"] })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor="nd-jur" className="mb-1 block text-sm text-muted">Jurisdiction (optional)</label>
          <input id="nd-jur" className="field min-h-11 w-full" value={f.jurisdiction} maxLength={60} onChange={(e) => setF({ ...f, jurisdiction: e.target.value })} />
        </div>
      </div>
      <div>
        <label htmlFor="nd-body" className="mb-1 block text-sm text-muted">Text ({f.body.length} / 1500)</label>
        <textarea id="nd-body" className="field min-h-32 w-full" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} aria-invalid={!!errs.body} aria-describedby={errs.body ? "nd-body-err" : undefined} />
        {errs.body && <p id="nd-body-err" className="mt-1 text-sm text-red-600 dark:text-red-400">{errs.body}</p>}
      </div>
      {formError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
      <button type="submit" className="btn btn-primary min-h-11" disabled={sending}>{sending ? "Adding…" : "Add disclaimer"}</button>
    </form>
  );
}

function OwnItem({ d, busy, save }: { d: Disclaimer; busy: string | null; save: ReturnType<typeof useSave>["save"] }) {
  const [title, setTitle] = useState(d.title);
  const [body, setBody] = useState(d.body);
  const [reviewed, setReviewed] = useState(!d.needs_review);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");
  const dirty = title !== d.title || body !== d.body || reviewed !== !d.needs_review;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setErr("Give it a title.");
    if (!body.trim() || body.length > 1500) return setErr(body.trim() ? "Keep it to 1,500 characters or fewer." : "Enter the text.");
    setErr("");
    await save(`u-${d.id}`, "PATCH", `/api/disclaimers/${d.id}`, { title: title.trim(), body: body.trim(), needs_review: !reviewed }, `${title.trim()} saved.`);
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4 sm:p-6" noValidate aria-label={d.title}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs">{CATEGORY_LABEL[d.category]}</span>
        {d.jurisdiction && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs">{d.jurisdiction}</span>}
        {!reviewed && <span className="rounded-full border border-line px-2.5 py-0.5 text-xs">Needs legal review</span>}
      </div>
      <div>
        <label htmlFor={`t-${d.id}`} className="mb-1 block text-sm text-muted">Title</label>
        <input id={`t-${d.id}`} className="field min-h-11 w-full" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label htmlFor={`b-${d.id}`} className="mb-1 block text-sm text-muted">Text ({body.length} / 1500)</label>
        <textarea id={`b-${d.id}`} className="field min-h-28 w-full" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> A lawyer has reviewed this wording</label>
      {err && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary min-h-11" disabled={!dirty || busy === `u-${d.id}`}>{busy === `u-${d.id}` ? "Saving…" : "Save"}</button>
        {confirm ? (
          <>
            <span className="text-sm">Delete this disclaimer?</span>
            <button type="button" className="btn min-h-11" disabled={busy === `x-${d.id}`} onClick={() => void save(`x-${d.id}`, "DELETE", `/api/disclaimers/${d.id}`, {}, `${d.title} deleted.`)}>Yes, delete</button>
            <button type="button" className="btn min-h-11" onClick={() => setConfirm(false)}>Keep it</button>
          </>
        ) : (
          <button type="button" className="btn min-h-11" onClick={() => setConfirm(true)}>Delete</button>
        )}
      </div>
    </form>
  );
}
