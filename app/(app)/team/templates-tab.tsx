"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PRESETS } from "@/lib/presets";
import { SignatureDocSchema } from "@/lib/schema/document";
import { BLOCK_LABEL, lockableFields, PERSON_SOURCES, type TemplateSpec } from "@/lib/team/template";
import { call, Field, Status, useAction } from "./api";
import { PersonPreview } from "./preview";
import { Select } from "@/components/ui/select";

type TemplateRow = { id: string; name: string; doc_json: unknown; lock_json: { editable: string[] }; field_map: Record<string, string>; departments: string[]; is_active: boolean };
type SavedSignature = { id: string; name: string; mine: boolean };

const SAMPLE = { email: "alex.example@company.com", full_name: "Alex Example", first_name: "Alex", last_name: "Example", title: "Head of Sales", department: "Sales", phone: "+1 555 0100", mobile: "+1 555 0101", location: "London", custom: {} };

export function TemplatesTab() {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await call<{ templates: TemplateRow[] }>("GET", "/api/team/templates");
    if (r.ok) {
      setTemplates(r.data.templates);
      setLoadError("");
    } else setLoadError(r.message);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      <p className="max-w-2xl text-sm text-muted">
        A brand template is a signature design plus rules: which details come from the directory, and which few fields an employee may change themselves. Everything else (logo, banner, colours, links, disclaimer) stays locked.
      </p>
      <NewTemplate onCreated={(id) => { load(); setOpenId(id); }} />
      {loadError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      <section aria-labelledby="tpl-h" className="space-y-4">
        <h2 id="tpl-h" className="text-lg font-semibold">Your brand templates</h2>
        {templates?.length === 0 && <p className="text-sm text-muted">No templates yet. Create one above, then people with a directory entry can open My signature.</p>}
        {templates?.map((t) => (
          <TemplateCard key={t.id} t={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} onChanged={load} />
        ))}
      </section>
    </div>
  );
}

function NewTemplate({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"preset" | "signature">("preset");
  const [preset, setPreset] = useState(PRESETS[0]?.id ?? "");
  const [signature, setSignature] = useState("");
  const [saved, setSaved] = useState<SavedSignature[]>([]);
  const [departments, setDepartments] = useState("");
  const [nameError, setNameError] = useState("");
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (kind !== "signature" || saved.length) return;
    call<{ signatures: SavedSignature[] }>("GET", "/api/team/signatures").then((r) => {
      if (r.ok) {
        setSaved(r.data.signatures);
        setSignature(r.data.signatures[0]?.id ?? "");
      }
    });
  }, [kind, saved.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setNameError("Give the template a name.");
    setNameError("");
    const from = kind === "preset" ? { kind, id: preset } : { kind, id: signature };
    const r = await run("create", () => call<{ id: string }>("POST", "/api/team/templates", { name: name.trim(), from, departments: parseDepartments(departments) }));
    if (r.ok) {
      setName("");
      setDepartments("");
      onCreated(r.data.id);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-4 sm:p-6" aria-labelledby="nt-h" noValidate>
      <h2 id="nt-h" className="text-lg font-semibold">New brand template</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="nt-name" label="Name" error={nameError}><input id="nt-name" className="field w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={!!nameError} aria-describedby={nameError ? "nt-name-err" : undefined} /></Field>
        <Field id="nt-kind" label="Start from">
          <Select id="nt-kind" className="field w-full" value={kind} onChange={(e) => setKind(e.target.value as "preset" | "signature")}>
            <option value="preset">A ready-made design</option>
            <option value="signature">One of my saved signatures</option>
          </Select>
        </Field>
        {kind === "preset" ? (
          <Field id="nt-preset" label="Design">
            <Select id="nt-preset" className="field w-full" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.slice(0, 60).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.category})</option>)}
            </Select>
          </Field>
        ) : (
          <Field id="nt-sig" label="Saved signature" hint={saved.length === 0 ? "You have no saved signatures yet." : undefined}>
            <Select id="nt-sig" className="field w-full" value={signature} onChange={(e) => setSignature(e.target.value)} disabled={!saved.length}>
              {saved.map((s) => <option key={s.id} value={s.id}>{s.name}{s.mine ? "" : " (from an employee)"}</option>)}
            </Select>
          </Field>
        )}
        <Field id="nt-dept" label="Only for these departments (optional)" hint="Separate with commas. Leave empty for everyone without a more specific template.">
          <input id="nt-dept" className="field w-full" value={departments} onChange={(e) => setDepartments(e.target.value)} />
        </Field>
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy === "create" || (kind === "signature" && !signature)}>{busy === "create" ? "Creating…" : "Create template"}</button>
    </form>
  );
}

const parseDepartments = (s: string) => [...new Set(s.split(",").map((d) => d.trim()).filter(Boolean))].slice(0, 20);

function TemplateCard({ t, open, onToggle, onChanged }: { t: TemplateRow; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const { busy, error, notice, run } = useAction();
  const doc = useMemo(() => {
    const p = SignatureDocSchema.safeParse(t.doc_json);
    return p.success ? p.data : null;
  }, [t.doc_json]);
  const [name, setName] = useState(t.name);
  const [departments, setDepartments] = useState(t.departments.join(", "));
  const [editable, setEditable] = useState(new Set(t.lock_json.editable));
  const [map, setMap] = useState<Record<string, string>>(t.field_map);
  const dirty =
    name !== t.name ||
    departments !== t.departments.join(", ") ||
    [...editable].sort().join() !== [...t.lock_json.editable].sort().join() ||
    JSON.stringify(map) !== JSON.stringify(t.field_map);

  const fields = useMemo(() => (doc ? lockableFields(doc) : []), [doc]);
  const spec: TemplateSpec | null = doc ? { doc, lock: { editable: [...editable] }, field_map: map } : null;

  async function save() {
    if (!name.trim()) return;
    const r = await run("save", () => call("PATCH", `/api/team/templates/${t.id}`, { name: name.trim(), departments: parseDepartments(departments), lock: { editable: [...editable] }, field_map: map }), "Saved.");
    if (r.ok) onChanged();
  }
  async function setActive(is_active: boolean) {
    const r = await run("active", () => call("PATCH", `/api/team/templates/${t.id}`, { is_active }), is_active ? "Template switched on." : "Template switched off.");
    if (r.ok) onChanged();
  }
  async function remove() {
    if (!window.confirm(`Delete the template "${t.name}"? Signatures people already submitted keep their own copy.`)) return;
    const r = await run("del", () => call("DELETE", `/api/team/templates/${t.id}`), "Deleted.");
    if (r.ok) onChanged();
  }

  const panel = `tpl-panel-${t.id}`;
  return (
    <article className="card p-4 sm:p-6" aria-label={t.name}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t.name} {!t.is_active && <span className="ml-1 rounded-full border border-line px-2 py-0.5 text-xs font-normal">Off</span>}</h3>
          <p className="text-sm text-muted">{t.departments.length ? `For: ${t.departments.join(", ")}` : "For everyone"} · {t.lock_json.editable.length} editable {t.lock_json.editable.length === 1 ? "field" : "fields"}</p>
        </div>
        <button type="button" className="btn" aria-expanded={open} aria-controls={panel} onClick={onToggle}>{open ? "Close" : "Edit rules"}</button>
      </div>

      {open && (
        <div id={panel} className="mt-6 space-y-6">
          {!doc || !spec ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">This template&apos;s design is no longer valid. Delete it and create it again.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={`n-${t.id}`} label="Name"><input id={`n-${t.id}`} className="field w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
                <Field id={`d-${t.id}`} label="Only for these departments" hint="Comma separated. Empty means everyone."><input id={`d-${t.id}`} className="field w-full" value={departments} onChange={(e) => setDepartments(e.target.value)} /></Field>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Fields</legend>
                <p className="text-sm text-muted">Choose where each value comes from and whether the employee may change it. Anything not listed here (images, links, colours, layout) is always locked.</p>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {fields.map((f) => {
                    const id = `f-${t.id}-${f.key}`;
                    const label = `${BLOCK_LABEL[f.type] ?? f.type} · ${f.rule.label}`;
                    return (
                      <li key={f.key} className="grid gap-3 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                        <p className="text-sm font-medium">{label}<span className="block truncate text-xs font-normal text-muted">{String((doc.blocks[f.index] as Record<string, unknown>)[f.field] ?? "") || "Empty in the design"}</span></p>
                        <div>
                          <label htmlFor={`${id}-src`} className="sr-only">{label}: fill from</label>
                          <Select id={`${id}-src`} className="field w-full" value={map[f.key] ?? ""} onChange={(e) => { const m = { ...map }; if (e.target.value) m[f.key] = e.target.value; else delete m[f.key]; setMap(m); }}>
                            <option value="">Keep the design&apos;s text</option>
                            {Object.entries(PERSON_SOURCES).map(([k, l]) => <option key={k} value={k}>From directory: {l}</option>)}
                          </Select>
                        </div>
                        <label htmlFor={`${id}-edit`} className="flex min-h-11 items-center gap-2 text-sm">
                          <input id={`${id}-edit`} type="checkbox" className="size-5" checked={editable.has(f.key)} onChange={(e) => { const s = new Set(editable); if (e.target.checked) s.add(f.key); else s.delete(f.key); setEditable(s); }} />
                          Employee can edit
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <div>
                <h4 className="mb-2 text-sm font-semibold">Preview with a sample person</h4>
                <PersonPreview spec={spec} person={SAMPLE} values={{}} title={`Preview of ${t.name}`} />
              </div>
            </>
          )}
          <Status error={error} notice={notice} />
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || busy === "save" || !doc}>{busy === "save" ? "Saving…" : "Save changes"}</button>
            <button type="button" className="btn" onClick={() => setActive(!t.is_active)} disabled={busy === "active"}>{t.is_active ? "Switch off" : "Switch on"}</button>
            <button type="button" className="btn" onClick={remove} disabled={busy === "del"}>Delete</button>
          </div>
        </div>
      )}
    </article>
  );
}

