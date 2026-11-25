"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Mine } from "@/lib/team/mine";
import { buildDoc } from "@/lib/team/render";
import { lockableFields } from "@/lib/team/template";
import { call, Field, formatDate, Status, useAction } from "../api";
import { PersonPreview } from "../preview";

type Ok = Extract<Mine, { state: "ok" }>;

const STATUS_LABEL = { draft: "Draft", pending: "Waiting for review", approved: "Approved", rejected: "Rejected" } as const;

export function MineForm({ mine }: { mine: Ok }) {
  const router = useRouter();
  const { spec, name } = mine.template;
  const { busy, error, notice, run, setError } = useAction();

  const fields = useMemo(() => lockableFields(spec.doc).filter((f) => spec.lock.editable.includes(f.key)), [spec]);
  /** What each field shows before the employee changes anything: the directory value or the design's text. */
  const baseline = useMemo(() => {
    const b = buildDoc(spec, mine.person, {});
    const out: Record<string, string> = {};
    if (b.ok) for (const f of fields) out[f.key] = String((b.doc.blocks[f.index] as Record<string, unknown>)[f.field] ?? "");
    return out;
  }, [spec, mine.person, fields]);

  const start = mine.pending?.values_json ?? mine.approved?.values_json ?? {};
  const [inputs, setInputs] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, start[f.key] ?? baseline[f.key] ?? ""])));
  const [errs, setErrs] = useState<Record<string, string>>({});

  /** Only fields that differ from the directory value are sent, so later directory updates still flow through. */
  const values = useMemo(() => Object.fromEntries(fields.filter((f) => inputs[f.key] !== (baseline[f.key] ?? "")).map((f) => [f.key, inputs[f.key]])), [fields, inputs, baseline]);
  const lockedNames = useMemo(() => {
    const unlocked = new Set(spec.lock.editable);
    const names = new Set<string>();
    for (const f of lockableFields(spec.doc)) if (!unlocked.has(f.key)) names.add(f.rule.label);
    for (const b of spec.doc.blocks) if (b.type === "banner" || b.type === "avatar" || b.type === "social") names.add(b.type === "social" ? "Social links" : b.type === "banner" ? "Banner" : "Photo");
    names.add("Colours and layout");
    return [...names];
  }, [spec]);

  const hasPending = !!mine.pending;
  const dirty = JSON.stringify(values) !== JSON.stringify(mine.pending?.values_json ?? mine.approved?.values_json ?? {});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    for (const f of fields) {
      const v = inputs[f.key] ?? "";
      if (f.rule.required && !v.trim()) next[f.key] = `${f.rule.label} cannot be empty.`;
      else if (v.length > f.rule.max) next[f.key] = `${f.rule.label} can be at most ${f.rule.max} characters.`;
      else if (!f.rule.multiline && /[\r\n]/.test(v)) next[f.key] = `${f.rule.label} must be on one line.`;
    }
    setErrs(next);
    if (Object.keys(next).length) return;
    const r = await run("submit", () => call<{ status: string }>("POST", "/api/team/mine", { values }));
    if (r.ok) {
      setError("");
      router.refresh();
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        {mine.pending && (
          <p role="status" className="card border-l-4 p-4 text-sm">
            Your last change is waiting for review (sent {formatDate(mine.pending.created_at)}). Until it is approved, your approved signature stays in use. You cannot send another change until it has been reviewed.
          </p>
        )}
        {!mine.pending && mine.history[0]?.status === "rejected" && (
          <p role="alert" className="card border-l-4 p-4 text-sm">
            Your last change was not approved: {mine.history[0].review_note}
          </p>
        )}

        <form onSubmit={submit} className="card space-y-4 p-4 sm:p-6" aria-labelledby="mine-h" noValidate>
          <div>
            <h2 id="mine-h" className="text-lg font-semibold">{name}</h2>
            <p className="mt-1 text-sm text-muted">
              {mine.requireApproval ? "Changes are checked by an admin before they take effect." : "Changes take effect as soon as you save."}
            </p>
          </div>
          {fields.length === 0 ? (
            <p className="text-sm text-muted">Nothing in this signature can be edited by you. It is filled in from your directory entry.</p>
          ) : (
            fields.map((f) => {
              const id = `mine-${f.key.replace(".", "-")}`;
              const label = `${f.rule.label}`;
              return (
                <Field key={f.key} id={id} label={label} error={errs[f.key]}>
                  {f.rule.multiline ? (
                    <textarea id={id} className="field w-full py-2" rows={4} maxLength={f.rule.max} value={inputs[f.key] ?? ""} disabled={hasPending} aria-invalid={!!errs[f.key]} aria-describedby={errs[f.key] ? `${id}-err` : undefined} onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })} />
                  ) : (
                    <input id={id} className="field w-full" maxLength={f.rule.max} value={inputs[f.key] ?? ""} disabled={hasPending} aria-invalid={!!errs[f.key]} aria-describedby={errs[f.key] ? `${id}-err` : undefined} onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })} />
                  )}
                </Field>
              );
            })
          )}
          <p className="text-sm text-muted">Set by your organization: {lockedNames.join(", ")}. Ask an admin if one of these needs to change.</p>
          <Status error={error} notice={notice} />
          <button type="submit" className="btn btn-primary" disabled={hasPending || !dirty || busy === "submit" || fields.length === 0}>
            {busy === "submit" ? "Saving…" : mine.requireApproval ? "Send for approval" : "Save"}
          </button>
        </form>

        <section aria-labelledby="hist-h" className="space-y-3">
          <h2 id="hist-h" className="text-lg font-semibold">History</h2>
          {mine.history.length === 0 && <p className="text-sm text-muted">No changes yet.</p>}
          <ul className="divide-y divide-line rounded-2xl border border-line text-sm">
            {mine.history.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>Version {v.version_no} <span className="text-muted">{formatDate(v.created_at)}</span></span>
                <span className="rounded-full border border-line px-2 py-0.5 text-xs">{STATUS_LABEL[v.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
        <h2 className="text-lg font-semibold">Preview</h2>
        <PersonPreview spec={spec} person={mine.person} values={values} title="Preview of your signature" />
        <p className="text-sm text-muted">This is how your signature will look once it is installed in your email program.</p>
      </div>
    </div>
  );
}
