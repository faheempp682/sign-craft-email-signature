"use client";

import { useCallback, useEffect, useState } from "react";
import { AUDIENCES, MESSAGE_KINDS, describeRule, ruleSupport, type Audience, type MessageKind, type Rule } from "@/lib/rules/evaluate";
import { call, Field, Status, useAction } from "../api";
import { Pill } from "./ui";

type Template = { id: string; name: string; departments: string[]; is_active: boolean };
type Data = { rules: Rule[]; templates: Template[]; departments: string[] };
type Person = { id: string; full_name: string; email: string; department: string };
type Shape = { rule_name: string; template_name: string; implicit: boolean } | null;
type TestResult = { winner: Shape; gmail: (Shape & { same_as_winner: boolean }) | null; exchange: ((Shape & { same_as_winner: boolean; unverified: boolean }) | null) };

const KIND_LABEL: Record<MessageKind, string> = { any: "Any message", new: "New messages", reply: "Replies", forward: "Forwards" };
const AUDIENCE_LABEL: Record<Audience, string> = { any: "Anyone", internal: "Inside the organization", external: "Outside the organization" };
const parseDepts = (s: string) => s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean);

function Support({ rule }: { rule: Pick<Rule, "message_kind" | "audience" | "departments"> }) {
  const g = ruleSupport(rule, "gmail");
  const x = ruleSupport(rule, "exchange");
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs">
      <span>Gmail:</span>
      <Pill tone={g.level === "enforced" ? "good" : "warn"}>{g.level === "enforced" ? "followed" : "not applied"}</Pill>
      <span>Microsoft 365 script:</span>
      <Pill tone={x.level === "enforced" ? "good" : "warn"}>{x.level === "enforced" ? "followed" : x.level === "unverified" ? "included, unverified" : "not included"}</Pill>
    </p>
  );
}

export function RulesTab() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const { busy, error, notice, run } = useAction();

  const load = useCallback(async () => {
    const r = await call<Data>("GET", "/api/deploy/rules");
    if (r.ok) {
      setData(r.data);
      setLoadError("");
    } else setLoadError(r.message);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const nameOf = (id: string) => data?.templates.find((t) => t.id === id)?.name ?? "(missing template)";

  async function toggle(r: Rule) {
    const res = await run(`t-${r.id}`, () => call("PATCH", `/api/deploy/rules/${r.id}`, { is_active: !r.is_active }), "");
    if (res.ok) load();
  }
  async function remove(r: Rule) {
    if (!window.confirm(`Delete the rule "${r.name}"?`)) return;
    const res = await run(`d-${r.id}`, () => call("DELETE", `/api/deploy/rules/${r.id}`), "Rule deleted.");
    if (res.ok) load();
  }

  if (loadError) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="r-h">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 id="r-h" className="text-lg font-semibold">Rules</h2>
            <p className="mt-1 text-sm text-muted">
              A rule says which brand template applies when. The rule with the highest priority that matches wins; if two tie, the more specific one wins, then the older one. When no rule matches, the brand templates decide: a template for the person&apos;s department, otherwise the oldest general template.
            </p>
            <p className="mt-2 text-sm"><strong>Be aware:</strong> Gmail keeps one signature per address, so it only follows department rules (everything else uses the default). The Microsoft 365 script can follow internal or external and department rules; new versus reply uses a mail header and is unverified; forwards cannot be expressed. Each rule below shows exactly what it can do.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")} disabled={data.templates.length === 0}>New rule</button>
        </div>
        {data.templates.length === 0 && <p className="card p-4 text-sm text-muted">Create a brand template first (Team, Brand templates). Rules choose between templates.</p>}
        {data.rules.length === 0 && data.templates.length > 0 && <p className="card p-6 text-sm text-muted">No rules yet. Everyone gets the template that applies to their department, or the default.</p>}
        <ul className="space-y-3">
          {data.rules.map((r) => (
            <li key={r.id} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{r.name} {!r.is_active && <Pill>Off</Pill>}</p>
                  <p className="text-sm">{describeRule(r, nameOf(r.template_id))}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn" onClick={() => setEditing(r)}>Edit</button>
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => toggle(r)}>{r.is_active ? "Switch off" : "Switch on"}</button>
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => remove(r)}>Delete</button>
                </div>
              </div>
              <Support rule={r} />
            </li>
          ))}
        </ul>
        <Status error={error} notice={notice} />
      </section>

      {editing && <RuleForm key={editing === "new" ? "new" : editing.id} rule={editing === "new" ? null : editing} data={data} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}
      <TestPanel />
    </div>
  );
}

function RuleForm({ rule, data, onDone, onCancel }: { rule: Rule | null; data: Data; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [template, setTemplate] = useState(rule?.template_id ?? data.templates[0]?.id ?? "");
  const [kind, setKind] = useState<MessageKind>(rule?.message_kind ?? "any");
  const [audience, setAudience] = useState<Audience>(rule?.audience ?? "any");
  const [depts, setDepts] = useState((rule?.departments ?? []).join("; "));
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [active, setActive] = useState(rule?.is_active ?? true);
  const [fieldError, setFieldError] = useState<{ name?: string; priority?: string; depts?: string }>({});
  const { busy, error, run } = useAction();

  const departments = parseDepts(depts);
  const prio = Number(priority);
  const sentence = describeRule({ message_kind: kind, audience, departments, priority: Number.isFinite(prio) ? prio : 0, is_active: active }, data.templates.find((t) => t.id === template)?.name ?? "…");

  async function save() {
    const fe: typeof fieldError = {};
    if (!name.trim()) fe.name = "Give the rule a name.";
    if (!Number.isInteger(prio) || prio < 0 || prio > 1000) fe.priority = "Priority is a whole number from 0 to 1000.";
    if (departments.some((d) => d.includes(","))) fe.depts = "Separate departments with a semicolon. Names cannot contain commas.";
    setFieldError(fe);
    if (Object.keys(fe).length) return;
    const body = { name: name.trim(), template_id: template, message_kind: kind, audience, departments, priority: prio, is_active: active };
    const r = await run("save", () => (rule ? call("PATCH", `/api/deploy/rules/${rule.id}`, body) : call("POST", "/api/deploy/rules", body)));
    if (r.ok) onDone();
  }

  return (
    <section className="card max-w-3xl space-y-4 p-4 sm:p-6" aria-labelledby="rf-h">
      <h2 id="rf-h" className="text-lg font-semibold">{rule ? "Edit rule" : "New rule"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rf-name" label="Name" error={fieldError.name}>
          <input id="rf-name" className="field w-full" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldError.name} aria-describedby={fieldError.name ? "rf-name-err" : undefined} />
        </Field>
        <Field id="rf-tpl" label="Use this template">
          <select id="rf-tpl" className="field w-full" value={template} onChange={(e) => setTemplate(e.target.value)}>
            {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_active ? "" : " (off)"}</option>)}
          </select>
        </Field>
        <Field id="rf-kind" label="For this kind of message">
          <select id="rf-kind" className="field w-full" value={kind} onChange={(e) => setKind(e.target.value as MessageKind)}>
            {MESSAGE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field id="rf-aud" label="Sent to">
          <select id="rf-aud" className="field w-full" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
            {AUDIENCES.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
          </select>
        </Field>
        <Field id="rf-dep" label="From people in these departments (empty means all)" hint={data.departments.length ? `Separate with a semicolon. In your directory: ${data.departments.slice(0, 8).join(", ")}${data.departments.length > 8 ? ", …" : ""}` : "Separate with a semicolon."} error={fieldError.depts}>
          <input id="rf-dep" className="field w-full" value={depts} onChange={(e) => setDepts(e.target.value)} list="rf-dep-list" aria-invalid={!!fieldError.depts} aria-describedby={fieldError.depts ? "rf-dep-err" : undefined} />
          <datalist id="rf-dep-list">{data.departments.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field id="rf-prio" label="Priority (higher wins)" error={fieldError.priority}>
          <input id="rf-prio" className="field w-full" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} aria-invalid={!!fieldError.priority} aria-describedby={fieldError.priority ? "rf-prio-err" : undefined} />
        </Field>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" className="size-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Rule is on</span>
      </label>
      <div className="rounded-lg border border-line p-3 text-sm" aria-live="polite">
        <p className="font-medium">What this rule does</p>
        <p>{sentence}</p>
        <div className="mt-2"><Support rule={{ message_kind: kind, audience, departments }} /></div>
      </div>
      <Status error={error} notice="" />
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={save}>{busy === "save" ? "Saving…" : "Save rule"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function TestPanel() {
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState<"new" | "reply" | "forward">("new");
  const [audience, setAudience] = useState<"internal" | "external">("external");
  const [result, setResult] = useState<TestResult | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await call<{ people: Person[] }>("GET", `/api/team/people?limit=50&status=active${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
      if (r.ok) {
        const list = Array.isArray(r.data.people) ? r.data.people : [];
        setPeople(list);
        setPerson((p) => (list.some((x) => x.id === p) ? p : (list[0]?.id ?? "")));
      }
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]);

  async function test() {
    const r = await run("test", () => call<TestResult>("POST", "/api/deploy/rules/test", { person_id: person, kind, audience }));
    if (r.ok) setResult(r.data);
  }

  return (
    <section className="card max-w-3xl space-y-4 p-4 sm:p-6" aria-labelledby="t-h">
      <h2 id="t-h" className="text-lg font-semibold">Test it</h2>
      <p className="text-sm text-muted">Pick a person and a situation to see which template wins, and what Gmail and the Microsoft 365 script would really do.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="t-q" label="Find a person">
          <input id="t-q" className="field w-full" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field id="t-p" label="Person">
          <select id="t-p" className="field w-full" value={person} onChange={(e) => setPerson(e.target.value)}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.department ? ` (${p.department})` : ""}</option>)}
          </select>
        </Field>
        <Field id="t-k" label="Message">
          <select id="t-k" className="field w-full" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="new">A new message</option>
            <option value="reply">A reply</option>
            <option value="forward">A forward</option>
          </select>
        </Field>
        <Field id="t-a" label="Recipient is">
          <select id="t-a" className="field w-full" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}>
            <option value="external">Someone outside the organization</option>
            <option value="internal">Someone inside the organization</option>
          </select>
        </Field>
      </div>
      <button type="button" className="btn btn-primary" disabled={!person || busy !== null} onClick={test}>{busy === "test" ? "Checking…" : "Test"}</button>
      <Status error={error} notice="" />
      {result && (
        <dl className="space-y-3 text-sm" aria-live="polite">
          <div className="rounded-lg border border-line p-3">
            <dt className="text-muted">The rules say</dt>
            <dd className="font-medium">{result.winner ? <>Template &ldquo;{result.winner.template_name}&rdquo; <span className="font-normal text-muted">(from {result.winner.implicit ? "the brand template defaults" : `rule “${result.winner.rule_name}”`})</span></> : "No template applies. Create a brand template."}</dd>
          </div>
          <div className="rounded-lg border border-line p-3">
            <dt className="text-muted">Gmail would use</dt>
            <dd className="font-medium">{result.gmail?.template_name ? `“${result.gmail.template_name}”` : "nothing"}{result.gmail && result.winner && !result.gmail.same_as_winner && <span className="font-normal text-muted"> (Gmail cannot follow this rule; it keeps one signature per address)</span>}</dd>
          </div>
          <div className="rounded-lg border border-line p-3">
            <dt className="text-muted">The Microsoft 365 script would use</dt>
            <dd className="font-medium">{result.exchange?.template_name ? `“${result.exchange.template_name}”` : "nothing"}{result.exchange?.unverified && <span className="font-normal text-muted"> (depends on new versus reply detection, which is unverified)</span>}{result.exchange && result.winner && !result.exchange.same_as_winner && <span className="font-normal text-muted"> (the winning rule cannot be expressed in Exchange)</span>}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
