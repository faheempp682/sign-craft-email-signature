"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { call, Field, Status, useAction } from "./api";

export type PersonRow = {
  id: string;
  email: string;
  full_name: string;
  title: string;
  department: string;
  phone: string;
  mobile: string;
  location: string;
  source: string;
  status: string;
  user_id: string | null;
};
type Counts = { all: number; departments: Record<string, number>; sources: Record<string, number>; statuses: Record<string, number> };
type Listing = { people: PersonRow[]; total: number; counts: Counts };

const SOURCE_LABEL: Record<string, string> = { manual: "Added by hand", csv: "CSV import", google: "Google", microsoft: "Microsoft", crm: "CRM" };
const PAGE = 50;

export function PeopleTab({ onImport }: { onImport: () => void }) {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [source, setSource] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<PersonRow | "new" | null>(null);
  const { busy, error, notice, run } = useAction();
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (q.trim()) p.set("q", q.trim());
    if (department) p.set("department", department);
    if (source) p.set("source", source);
    const r = await call<Listing>("GET", `/api/team/people?${p}`);
    if (mine !== seq.current) return;
    if (r.ok) {
      setData(r.data);
      setLoadError("");
    } else setLoadError(r.message);
  }, [q, department, source, offset]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const counts = data?.counts;
  const departments = Object.keys(counts?.departments ?? {}).sort();

  async function toggle(p: PersonRow) {
    const next = p.status === "active" ? "inactive" : "active";
    const r = await run(`t-${p.id}`, () => call("PATCH", `/api/team/people/${p.id}`, { person: { status: next } }), `${p.full_name} is now ${next}.`);
    if (r.ok) load();
  }
  async function remove(p: PersonRow) {
    if (!window.confirm(`Remove ${p.full_name} from the directory? Their signature history is removed too. Marking them inactive keeps it.`)) return;
    const r = await run(`d-${p.id}`, () => call("DELETE", `/api/team/people/${p.id}`), `${p.full_name} was removed.`);
    if (r.ok) load();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3" aria-label="Directory totals">
        <Stat label="People" value={counts?.all} />
        <Stat label="Active" value={counts?.statuses.active ?? 0} />
        <Stat label="Departments" value={departments.length} />
      </div>

      <div className="card space-y-4 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="p-q" label="Search">
            <input id="p-q" type="search" className="field w-full" placeholder="Name, email or title" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} maxLength={80} />
          </Field>
          <Field id="p-dept" label="Department">
            <select id="p-dept" className="field w-full" value={department} onChange={(e) => { setDepartment(e.target.value); setOffset(0); }}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d} ({counts?.departments[d]})</option>)}
            </select>
          </Field>
          <Field id="p-src" label="Source">
            <select id="p-src" className="field w-full" value={source} onChange={(e) => { setSource(e.target.value); setOffset(0); }}>
              <option value="">All sources</option>
              {Object.keys(counts?.sources ?? {}).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s] ?? s} ({counts?.sources[s]})</option>)}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>Add a person</button>
          <button type="button" className="btn" onClick={onImport}>Import a CSV</button>
          <a className="btn" href="/api/team/people/export" download>Export CSV</a>
        </div>
      </div>

      {editing && <PersonForm key={editing === "new" ? "new" : editing.id} person={editing === "new" ? null : editing} departments={departments} onDone={(changed) => { setEditing(null); if (changed) load(); }} />}

      <Status error={error || loadError} notice={notice} />

      {data && data.people.length === 0 && (
        <p className="card p-6 text-sm text-muted">{counts?.all ? "Nobody matches those filters." : "The directory is empty. Add a person or import a CSV file to start."}</p>
      )}

      {data && data.people.length > 0 && (
        <>
          <ul className="space-y-3 md:hidden" aria-label="People">
            {data.people.map((p) => (
              <li key={p.id} className="card space-y-2 p-4">
                <PersonSummary p={p} />
                <PersonActions p={p} busy={busy} onEdit={() => setEditing(p)} onToggle={() => toggle(p)} onRemove={() => remove(p)} />
              </li>
            ))}
          </ul>
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">People in the directory</caption>
              <thead className="text-left text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="p-3 font-medium">Name</th>
                  <th scope="col" className="p-3 font-medium">Title</th>
                  <th scope="col" className="p-3 font-medium">Department</th>
                  <th scope="col" className="p-3 font-medium">Source</th>
                  <th scope="col" className="p-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.people.map((p) => (
                  <tr key={p.id} className={p.status === "inactive" ? "opacity-70" : ""}>
                    <td className="p-3"><div className="font-medium">{p.full_name}</div><div className="text-muted">{p.email}</div></td>
                    <td className="p-3">{p.title || <span className="text-muted">None</span>}</td>
                    <td className="p-3">{p.department || <span className="text-muted">None</span>}</td>
                    <td className="p-3">{SOURCE_LABEL[p.source] ?? p.source}{p.status === "inactive" && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs">Inactive</span>}</td>
                    <td className="p-3"><PersonActions p={p} busy={busy} onEdit={() => setEditing(p)} onToggle={() => toggle(p)} onRemove={() => remove(p)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="flex items-center justify-between text-sm text-muted" aria-label="Pages">
            <span>{offset + 1} to {Math.min(offset + PAGE, data.total)} of {data.total}</span>
            <span className="flex gap-2">
              <button type="button" className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <button type="button" className="btn" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </span>
          </nav>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value ?? "…"}</p>
    </div>
  );
}

function PersonSummary({ p }: { p: PersonRow }) {
  return (
    <div>
      <p className="font-medium">{p.full_name}{p.status === "inactive" && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs font-normal">Inactive</span>}</p>
      <p className="break-all text-sm text-muted">{p.email}</p>
      <p className="text-sm text-muted">{[p.title, p.department].filter(Boolean).join(" · ") || "No title or department"} · {SOURCE_LABEL[p.source] ?? p.source}</p>
    </div>
  );
}

function PersonActions({ p, busy, onEdit, onToggle, onRemove }: { p: PersonRow; busy: string | null; onEdit: () => void; onToggle: () => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn" onClick={onEdit} aria-label={`Edit ${p.full_name}`}>Edit</button>
      <button type="button" className="btn" disabled={busy === `t-${p.id}`} onClick={onToggle} aria-label={`${p.status === "active" ? "Deactivate" : "Activate"} ${p.full_name}`}>{p.status === "active" ? "Deactivate" : "Activate"}</button>
      <button type="button" className="btn" disabled={busy === `d-${p.id}`} onClick={onRemove} aria-label={`Remove ${p.full_name}`}>Remove</button>
    </div>
  );
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function PersonForm({ person, departments, onDone }: { person: PersonRow | null; departments: string[]; onDone: (changed: boolean) => void }) {
  const [f, setF] = useState({
    email: person?.email ?? "",
    full_name: person?.full_name ?? "",
    title: person?.title ?? "",
    department: person?.department ?? "",
    phone: person?.phone ?? "",
    mobile: person?.mobile ?? "",
    location: person?.location ?? "",
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!EMAIL.test(f.email.trim())) next.email = "Enter a valid email address.";
    if (!f.full_name.trim()) next.full_name = "Enter the person's name.";
    setErrs(next);
    if (Object.keys(next).length) return;
    const r = await run("save", () => (person ? call("PATCH", `/api/team/people/${person.id}`, { person: f }) : call("POST", "/api/team/people", { person: f })));
    if (r.ok) onDone(true);
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-4 sm:p-6" aria-labelledby="pf-h" noValidate>
      <h2 id="pf-h" className="text-lg font-semibold">{person ? `Edit ${person.full_name}` : "Add a person"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pf-email" label="Email" error={errs.email}><input id="pf-email" type="email" className="field w-full" value={f.email} onChange={set("email")} maxLength={254} aria-invalid={!!errs.email} aria-describedby={errs.email ? "pf-email-err" : undefined} /></Field>
        <Field id="pf-name" label="Full name" error={errs.full_name}><input id="pf-name" className="field w-full" value={f.full_name} onChange={set("full_name")} maxLength={120} aria-invalid={!!errs.full_name} aria-describedby={errs.full_name ? "pf-name-err" : undefined} /></Field>
        <Field id="pf-title" label="Job title"><input id="pf-title" className="field w-full" value={f.title} onChange={set("title")} maxLength={100} /></Field>
        <Field id="pf-dept" label="Department">
          <input id="pf-dept" className="field w-full" list="pf-depts" value={f.department} onChange={set("department")} maxLength={80} />
          <datalist id="pf-depts">{departments.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field id="pf-phone" label="Phone"><input id="pf-phone" type="tel" className="field w-full" value={f.phone} onChange={set("phone")} maxLength={40} /></Field>
        <Field id="pf-mobile" label="Mobile"><input id="pf-mobile" type="tel" className="field w-full" value={f.mobile} onChange={set("mobile")} maxLength={40} /></Field>
        <Field id="pf-loc" label="Location"><input id="pf-loc" className="field w-full" value={f.location} onChange={set("location")} maxLength={120} /></Field>
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</button>
        <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </form>
  );
}
