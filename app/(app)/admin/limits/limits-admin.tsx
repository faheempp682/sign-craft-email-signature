"use client";

import { useState } from "react";
import type { AiFeature, Role } from "@/lib/authz/roles";
import { ROLE_NAME, Status, useSave } from "../use-save";

export type LimitRow = { role: Role; feature: AiFeature; label: string; perMinute: number | null; perDay: number | null; configured: boolean };
export type UsageRow = { who: string; feature: AiFeature; label: string; calls: number; tokensIn: number; tokensOut: number };

const show = (n: number | null) => (n === null ? "" : String(n));

/** Blank means no limit. Anything else must be a whole number, so "5.5" or "abc" is caught before it is sent. */
function parse(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  return /^\d{1,7}$/.test(t) ? { ok: true, value: Number(t) } : { ok: false };
}

export type SignatureLimitInfo = { adminValue: number | null; fallback: number; tableMissing: boolean };

/** How many saved signatures one account may keep. Blank = use the environment value (MAX_SIGNATURES_PER_ACCOUNT, else 5). */
function SignatureLimitCard({ info, busy, onSave }: { info: SignatureLimitInfo; busy: boolean; onSave: (limit: number | null) => void }) {
  const [text, setText] = useState(info.adminValue === null ? "" : String(info.adminValue));
  const [bad, setBad] = useState(false);
  const current = info.adminValue === null ? "" : String(info.adminValue);

  function submit() {
    const t = text.trim();
    if (t === "") return onSave(null);
    const n = Number(t);
    if (!/^\d{1,4}$/.test(t) || n < 1 || n > 1000) return setBad(true);
    setBad(false);
    onSave(n);
  }

  return (
    <section aria-labelledby="sig-limit-h">
      <h2 id="sig-limit-h" className="text-lg font-semibold">Saved signatures per account</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="card mt-3 grid items-end gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:px-6"
      >
        <div>
          <label className="mb-1 block text-sm text-muted" htmlFor="sig-limit">Most signatures one account can keep</label>
          <input id="sig-limit" inputMode="numeric" className="field w-full sm:max-w-40" placeholder={String(info.fallback)} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={bad} />
        </div>
        <button type="submit" className="btn btn-primary min-h-11" disabled={busy || text.trim() === current}>
          {busy ? "Saving…" : "Save"}
        </button>
        <p className="text-sm text-muted sm:col-span-2">
          {info.adminValue === null ? `Using ${info.fallback} (from MAX_SIGNATURES_PER_ACCOUNT, or the built-in default of 5). ` : `Set here to ${info.adminValue}. `}
          These are the signatures one person saves in their own account, not separate people. Leave blank to use the environment value. Accounts already over a new, lower limit keep what they have but cannot save more.
        </p>
        {info.tableMissing && <p className="text-sm text-red-600 sm:col-span-2 dark:text-red-400">Run <code>supabase/migrations/0019_platform_settings.sql</code> to save this setting here.</p>}
        {bad && <p className="text-sm text-red-600 sm:col-span-2 dark:text-red-400">Enter a whole number from 1 to 1000, or leave it blank.</p>}
      </form>
    </section>
  );
}

export function LimitsAdmin({ rows, usage, truncated, signatureLimit }: { rows: LimitRow[]; usage: UsageRow[]; truncated: boolean; signatureLimit: SignatureLimitInfo }) {
  const { busy, error, notice, save } = useSave();
  const [draft, setDraft] = useState<Record<string, { m: string; d: string }>>({});
  const [bad, setBad] = useState("");

  const id = (r: LimitRow) => `${r.role}:${r.feature}`;
  const get = (r: LimitRow) => draft[id(r)] ?? { m: show(r.perMinute), d: show(r.perDay) };
  const dirty = (r: LimitRow) => {
    const g = get(r);
    return g.m.trim() !== show(r.perMinute) || g.d.trim() !== show(r.perDay);
  };

  async function submit(r: LimitRow) {
    const g = get(r);
    const m = parse(g.m);
    const d = parse(g.d);
    if (!m.ok || !d.ok) {
      setBad(id(r));
      return;
    }
    setBad("");
    await save(id(r), "PUT", "/api/admin/limits", { role: r.role, feature: r.feature, per_minute: m.value, per_day: d.value }, `${r.label} limits for ${ROLE_NAME[r.role].toLowerCase()}s saved.`);
  }

  const features = [...new Set(rows.map((r) => r.feature))];

  return (
    <div className="space-y-10">
      <Status error={error} notice={notice} />
      <SignatureLimitCard
        key={signatureLimit.adminValue ?? "env"}
        info={signatureLimit}
        busy={busy === "signature-limit"}
        onSave={(limit) => void save("signature-limit", "PUT", "/api/admin/signature-limit", { limit }, limit === null ? "Signature limit reset to the environment value." : `Accounts can now keep ${limit} saved signatures.`)}
      />
      <p className="max-w-2xl text-sm text-muted">
        Limits are per person. Leave a box blank for no limit; enter 0 to block the feature. A role with no row uses the Member limits.
      </p>

      {features.map((feature) => (
        <section key={feature} aria-labelledby={`h-${feature}`}>
          <h2 id={`h-${feature}`} className="text-lg font-semibold">{rows.find((r) => r.feature === feature)?.label}</h2>
          <div className="card mt-3 divide-y divide-line">
            {rows
              .filter((r) => r.feature === feature)
              .map((r) => {
                const g = get(r);
                const k = id(r);
                return (
                  <form
                    key={k}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submit(r);
                    }}
                    className="grid items-end gap-3 px-4 py-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:px-6"
                  >
                    <p className="font-medium sm:pb-2.5">
                      {ROLE_NAME[r.role]}
                      {!r.configured && <span className="ml-2 text-xs font-normal text-muted">uses Member</span>}
                    </p>
                    <div>
                      <label className="mb-1 block text-sm text-muted" htmlFor={`m-${k}`}>Per minute</label>
                      <input id={`m-${k}`} inputMode="numeric" className="field w-full" placeholder="No limit" value={g.m} onChange={(e) => setDraft({ ...draft, [k]: { ...g, m: e.target.value } })} aria-invalid={bad === k} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm text-muted" htmlFor={`d-${k}`}>Per day</label>
                      <input id={`d-${k}`} inputMode="numeric" className="field w-full" placeholder="No limit" value={g.d} onChange={(e) => setDraft({ ...draft, [k]: { ...g, d: e.target.value } })} aria-invalid={bad === k} />
                    </div>
                    <button type="submit" className="btn btn-primary min-h-11" disabled={!dirty(r) || busy === k}>
                      {busy === k ? "Saving…" : "Save"}
                    </button>
                    {bad === k && <p className="text-sm text-red-600 sm:col-span-4 dark:text-red-400">Enter whole numbers only, or leave a box blank for no limit.</p>}
                  </form>
                );
              })}
          </div>
        </section>
      ))}

      <section aria-labelledby="usage-h">
        <h2 id="usage-h" className="text-lg font-semibold">Last 24 hours</h2>
        {usage.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No AI calls in the last 24 hours.</p>
        ) : (
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium sm:px-6">Person</th>
                  <th className="px-2 py-2 font-medium">Feature</th>
                  <th className="px-2 py-2 text-right font-medium">Calls</th>
                  <th className="px-2 py-2 text-right font-medium">Tokens in</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-6">Tokens out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {usage.map((u) => (
                  <tr key={`${u.who}:${u.feature}`}>
                    <td className="px-4 py-2 sm:px-6">{u.who}</td>
                    <td className="px-2 py-2">{u.label}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{u.calls}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{u.tokensIn.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums sm:px-6">{u.tokensOut.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {truncated && <p className="mt-2 text-sm text-muted">Showing the most recent 5,000 calls only, so totals may be low.</p>}
      </section>
    </div>
  );
}
