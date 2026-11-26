"use client";

import { useCallback, useEffect, useState } from "react";
import { CRM_TARGETS, DIRECTORY_FIELDS, FIELD_LABEL, SOURCE_LABEL, type Policy, type SyncSource } from "@/lib/sync/types";
import { call, Field, Status, useAction } from "../api";
import type { SourceCard, SourceSettingsData, StatusData } from "./sync-types";
import { Select } from "@/components/ui/select";

type Row = { from: string; kind: "field" | "custom"; field: string; key: string; policy: Policy };
type TestRow = { from: string; to: string; found: boolean; value: string; note: string };
type TestResult = { found: boolean; rows: TestRow[]; paths: { path: string; sample: string }[] };

const toRow = (m: { from: string; to: string }, policy: Policy): Row => (m.to.startsWith("custom.") ? { from: m.from, kind: "custom", field: "title", key: m.to.slice(7), policy } : { from: m.from, kind: "field", field: m.to, key: "", policy });
const target = (r: Row) => (r.kind === "custom" ? `custom.${r.key.trim()}` : r.field);
const targetLabel = (r: Row) => (r.kind === "custom" ? `custom field "${r.key.trim() || "…"}"` : FIELD_LABEL[r.field]);

export function RulesTab({ status, onChanged }: { status: StatusData; onChanged: () => void }) {
  const [source, setSource] = useState<SyncSource>(status.sources[0].source);
  const card = status.sources.find((s) => s.source === source) as SourceCard;
  return (
    <div className="space-y-6">
      <Field id="rl-source" label="Source">
        <Select id="rl-source" className="field w-full sm:w-auto" value={source} onChange={(e) => setSource(e.target.value as SyncSource)}>
          {status.sources.map((s) => (
            <option key={s.source} value={s.source}>{s.label}</option>
          ))}
        </Select>
      </Field>
      <SourceRules key={source} source={source} kind={card.kind} onChanged={onChanged} />
    </div>
  );
}

function SourceRules({ source, kind, onChanged }: { source: SyncSource; kind: "directory" | "crm"; onChanged: () => void }) {
  const crm = kind === "crm";
  const defaultPolicy: Policy = crm ? "directory" : "source";
  const [loaded, setLoaded] = useState<SourceSettingsData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [auto, setAuto] = useState(false);
  const [blank, setBlank] = useState(false);
  const [policy, setPolicy] = useState<Record<string, Policy>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [conn, setConn] = useState({ base_url: "", auth_header: "Authorization", auth_prefix: "Bearer ", path_template: "/contacts?email={email}" });
  const [testEmail, setTestEmail] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [fieldError, setFieldError] = useState("");
  const { busy, error, notice, run, setError } = useAction();

  const load = useCallback(async () => {
    const r = await call<SourceSettingsData>("GET", `/api/sync/sources/${source}`);
    if (!r.ok) return setLoadError(r.message);
    const d = r.data;
    setLoaded(d);
    setEnabled(d.enabled);
    setAuto(d.auto_apply);
    setBlank(d.allow_blank_overwrite);
    setPolicy(d.field_policy);
    const cfg = d.config as { mapping?: { from: string; to: string }[]; base_url?: string; auth_header?: string; auth_prefix?: string; path_template?: string };
    setRows((cfg.mapping ?? []).map((m) => toRow(m, d.field_policy[m.to] ?? defaultPolicy)));
    if (source === "generic" && cfg.base_url) setConn({ base_url: cfg.base_url, auth_header: cfg.auth_header ?? "Authorization", auth_prefix: cfg.auth_prefix ?? "", path_template: cfg.path_template ?? "" });
  }, [source, defaultPolicy]);
  useEffect(() => {
    load();
  }, [load]);

  const mapping = () => rows.map((r) => ({ from: r.from.trim(), to: target(r) }));
  const config = () => (source === "hubspot" ? { mapping: mapping() } : source === "generic" ? { ...conn, mapping: mapping() } : {});
  const fieldPolicy = () => (crm ? Object.fromEntries(rows.map((r) => [target(r), r.policy])) : Object.fromEntries(DIRECTORY_FIELDS.map((f) => [f, policy[f] ?? defaultPolicy])));

  async function save() {
    setFieldError("");
    if (crm && rows.some((r) => !r.from.trim() || (r.kind === "custom" && !/^[a-z][a-z0-9_]{0,29}$/.test(r.key.trim())))) {
      setFieldError("Every mapping needs a CRM field, and custom field names use lower-case letters, digits and underscores (for example booking_link).");
      return;
    }
    const r = await run("save", () => call("PUT", `/api/sync/sources/${source}`, { enabled, auto_apply: auto, allow_blank_overwrite: blank, field_policy: fieldPolicy(), config: config() }), "Saved.");
    if (r.ok) {
      onChanged();
      load();
    }
  }

  async function runTest() {
    setTest(null);
    setError("");
    const r = await run("test", () => call<TestResult>("POST", "/api/sync/test", { source, email: testEmail, config: config() }), "");
    if (r.ok) setTest(r.data);
  }

  if (!loaded) return <Status error={loadError} notice="" />;

  return (
    <div className="space-y-8">
      <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="run-h">
        <h2 id="run-h" className="text-lg font-semibold">Unattended runs</h2>
        <Switch id="sw-enabled" label="Include this source in scheduled runs" hint="A scheduled run (see Settings) computes a preview for this source. It does nothing else unless you also turn on auto-apply." on={enabled} onChange={(v) => { setEnabled(v); if (!v) setAuto(false); }} />
        <Switch id="sw-auto" label="Apply scheduled changes automatically" hint="Only when the safety cap passes. If it does not, the preview waits here for you. Off: every scheduled run waits for your confirmation." on={auto} disabled={!enabled} onChange={setAuto} />
      </section>

      {crm && source === "generic" && (
        <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="conn-h">
          <h2 id="conn-h" className="text-lg font-semibold">Connection</h2>
          <p className="text-sm text-muted">The secret is read from <code>KIMP_CRM_SECRET</code> on the server. It is never stored in the browser or the database and cannot be shown again. Only https addresses on the public internet are allowed; redirects to other hosts or private addresses are refused.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cn-base" label="Base URL" hint="For example https://crm.example.com/api"><input id="cn-base" className="field w-full" value={conn.base_url} onChange={(e) => setConn({ ...conn, base_url: e.target.value })} inputMode="url" autoComplete="off" /></Field>
            <Field id="cn-path" label="Path for one person" hint="Must contain {email}, for example /contacts?email={email}"><input id="cn-path" className="field w-full" value={conn.path_template} onChange={(e) => setConn({ ...conn, path_template: e.target.value })} autoComplete="off" /></Field>
            <Field id="cn-header" label="Auth header name" hint="For example Authorization or X-Api-Key"><input id="cn-header" className="field w-full" value={conn.auth_header} onChange={(e) => setConn({ ...conn, auth_header: e.target.value })} autoComplete="off" /></Field>
            <Field id="cn-prefix" label="Text before the secret" hint="For example “Bearer ” (with the space). Leave empty for a plain key."><input id="cn-prefix" className="field w-full" value={conn.auth_prefix} onChange={(e) => setConn({ ...conn, auth_prefix: e.target.value })} autoComplete="off" /></Field>
          </div>
        </section>
      )}

      <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="rules-h">
        <h2 id="rules-h" className="text-lg font-semibold">{crm ? "Which CRM field fills which people field" : "Who wins for each field"}</h2>
        <p className="text-sm text-muted">
          <strong className="text-ink">{SOURCE_LABEL[source]} wins</strong>: the sync overwrites the directory value whenever the source has one.{" "}
          <strong className="text-ink">SignCraft wins</strong>: the sync only fills a field that is empty, so anything someone typed by hand stays.
        </p>

        {!crm && (
          <ul className="divide-y divide-line" aria-label="Fields">
            {DIRECTORY_FIELDS.map((f) => (
              <li key={f} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <label htmlFor={`pol-${f}`} className="font-medium">{FIELD_LABEL[f]}{f === "status" && <span className="block text-sm font-normal text-muted">Suspended accounts and people missing from the source become inactive. “SignCraft wins” turns that off.</span>}</label>
                <PolicySelect id={`pol-${f}`} value={policy[f] ?? defaultPolicy} source={source} onChange={(v) => setPolicy({ ...policy, [f]: v })} />
              </li>
            ))}
          </ul>
        )}

        {crm && (
          <div className="space-y-4">
            {rows.length === 0 && <p className="text-sm text-muted">No mapping yet. Add the first one.</p>}
            <ul className="space-y-4">
              {rows.map((r, i) => (
                <li key={i} className="rounded-lg border border-line p-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                    <Field id={`m-from-${i}`} label={source === "hubspot" ? "HubSpot property" : "Path in the CRM answer"} hint={source === "hubspot" ? "Internal name, e.g. jobtitle, phone, or owner_name" : "e.g. $.data.phone"}>
                      <input id={`m-from-${i}`} className="field w-full" value={r.from} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} autoComplete="off" />
                    </Field>
                    <div>
                      <Field id={`m-to-${i}`} label="People field">
                        <Select id={`m-to-${i}`} className="field w-full" value={r.kind === "custom" ? "__custom" : r.field} onChange={(e) => setRows(rows.map((x, j) => (j === i ? (e.target.value === "__custom" ? { ...x, kind: "custom" as const } : { ...x, kind: "field" as const, field: e.target.value }) : x)))}>
                          {CRM_TARGETS.map((f) => (
                            <option key={f} value={f}>{FIELD_LABEL[f]}</option>
                          ))}
                          <option value="__custom">Custom field…</option>
                        </Select>
                      </Field>
                      {r.kind === "custom" && (
                        <div className="mt-2">
                          <Field id={`m-key-${i}`} label="Custom field name" hint="Lower case, e.g. booking_link">
                            <input id={`m-key-${i}`} className="field w-full" value={r.key} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} autoComplete="off" />
                          </Field>
                        </div>
                      )}
                    </div>
                    <Field id={`m-pol-${i}`} label="If both have a value">
                      <PolicySelect id={`m-pol-${i}`} value={r.policy} source={source} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, policy: v } : x)))} />
                    </Field>
                    <button type="button" className="btn" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove mapping ${i + 1}`}>Remove</button>
                  </div>
                  <p className="mt-3 text-sm" data-testid={`sentence-${i}`}>
                    {r.from.trim() ? <code className="rounded border border-line px-1.5 py-0.5 text-xs">{r.from.trim()}</code> : "This CRM field"}{" "}
                    {r.policy === "source" ? <strong>overwrites</strong> : <>fills</>} the people field <strong>{targetLabel(r)}</strong>
                    {r.policy === "source" ? ", replacing what is in the directory." : ", only when it is empty in the directory."}
                  </p>
                </li>
              ))}
            </ul>
            {rows.length < 15 && <button type="button" className="btn" onClick={() => setRows([...rows, { from: "", kind: "field", field: "phone", key: "", policy: "directory" }])}>Add a mapping</button>}
          </div>
        )}

        <div className="border-t border-line pt-4">
          <Switch id="sw-blank" label="Let an empty value erase what is in the directory" hint={`Off (recommended): an empty ${SOURCE_LABEL[source]} value never removes anything. On: it clears the field, but only where ${SOURCE_LABEL[source]} wins. The safety cap counts these.`} on={blank} onChange={setBlank} />
        </div>
      </section>

      {crm && (
        <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="test-h">
          <h2 id="test-h" className="text-lg font-semibold">Test with one person</h2>
          <p className="text-sm text-muted">Looks up one email in {SOURCE_LABEL[source]} using the settings above (saved or not) and shows exactly what would be filled. Nothing is written.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field id="test-email" label="Email to look up"><input id="test-email" type="email" className="field w-full sm:w-72" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} autoComplete="off" /></Field>
            <button type="button" className="btn" disabled={!testEmail || busy === "test"} onClick={runTest}>{busy === "test" ? "Looking up…" : "Test"}</button>
          </div>
          {test && !test.found && <p role="status" className="text-sm text-muted">The CRM has no record for that email.</p>}
          {test && test.found && (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <caption className="sr-only">What would be mapped for this person</caption>
                <thead className="text-left text-muted"><tr className="border-b border-line"><th scope="col" className="p-2 font-medium">CRM field</th><th scope="col" className="p-2 font-medium">Fills</th><th scope="col" className="p-2 font-medium">Value</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {test.rows.map((t, i) => (
                    <tr key={i}>
                      <td className="break-words p-2"><code className="break-all text-xs">{t.from}</code></td>
                      <td className="break-words p-2">{t.to.startsWith("custom.") ? `Custom: ${t.to.slice(7)}` : FIELD_LABEL[t.to]}</td>
                      <td className="break-words p-2">{t.value ? <strong className="font-medium">{t.value}</strong> : <span className="text-muted">{t.note || "(empty)"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {test.paths.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="min-h-11 cursor-pointer py-2 font-medium">Paths in the CRM answer (to help write the mapping)</summary>
                  <ul className="mt-1 space-y-1 text-muted">
                    {test.paths.map((p) => (
                      <li key={p.path}><code className="text-xs text-ink">{p.path}</code> {p.sample}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      <div className="space-y-2">
        {fieldError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldError}</p>}
        <Status error={error} notice={notice} />
        <button type="button" className="btn btn-primary" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

function PolicySelect({ id, value, source, onChange }: { id: string; value: Policy; source: SyncSource; onChange: (v: Policy) => void }) {
  return (
    <Select id={id} className="field w-full sm:w-auto" value={value} onChange={(e) => onChange(e.target.value as Policy)}>
      <option value="source">{SOURCE_LABEL[source]} wins (overwrite)</option>
      <option value="directory">SignCraft wins (fill empty only)</option>
    </Select>
  );
}

function Switch({ id, label, hint, on, onChange, disabled }: { id: string; label: string; hint: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p id={`${id}-l`} className="font-medium">{label}</p>
        <p id={`${id}-d`} className="mt-1 text-sm text-muted">{hint}</p>
      </div>
      <button type="button" role="switch" id={id} aria-checked={on} aria-labelledby={`${id}-l`} aria-describedby={`${id}-d`} disabled={disabled} onClick={() => onChange(!on)} className="grid min-h-11 min-w-11 shrink-0 cursor-pointer place-items-center disabled:cursor-not-allowed disabled:opacity-40">
        <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-150 ${on ? "bg-accent" : "bg-line"}`}>
          <span className={`inline-block size-5 rounded-full bg-card shadow transition-transform duration-150 ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
        </span>
      </button>
    </div>
  );
}
