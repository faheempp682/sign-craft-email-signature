"use client";

import { useCallback, useEffect, useState } from "react";
import { customKeyFromHeader, PERSON_FIELDS } from "@/lib/team/people";
import { call, formatDate, Status, useAction } from "./api";

type Mapping = Record<number, string>;
type Preview = { fatal: string | null; headers: string[]; delimiter: string; sample: string[][]; mapping: Mapping; totalRows: number };
type DryRun = {
  fatal: string | null;
  totalRows: number;
  validCount: number;
  creates: number;
  updates: number;
  rowsWithErrors: number;
  errors: { row: number; field: string; message: string }[];
  moreErrors: number;
  preview: { row: number; action: "create" | "update"; person: { email: string; full_name: string; title: string; department: string } }[];
};
type ImportRow = { id: string; filename: string; source: string; total_rows: number; created: number; updated: number; skipped: number; created_at: string };

const MAX_BYTES = 2 * 1024 * 1024;
const DELIMITER_NAME: Record<string, string> = { ",": "commas", ";": "semicolons", "\t": "tabs" };

export function ImportTab({ onDone }: { onDone: () => void }) {
  const [filename, setFilename] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [dry, setDry] = useState<DryRun | null>(null);
  const [skip, setSkip] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [history, setHistory] = useState<ImportRow[]>([]);
  const { busy, error, notice, run, setError } = useAction();

  const loadHistory = useCallback(async () => {
    const r = await call<{ imports: ImportRow[] }>("GET", "/api/team/imports");
    if (r.ok) setHistory(r.data.imports);
  }, []);
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  function reset() {
    setFilename("");
    setCsv("");
    setPreview(null);
    setMapping({});
    setDry(null);
    setSkip(false);
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setResult(null);
    setDry(null);
    setPreview(null);
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 2 MB. Split it into smaller files.");
      return;
    }
    const text = await file.text(); // read as text only; nothing in the file is ever run or fetched
    setFilename(file.name.slice(0, 200));
    setCsv(text);
    const r = await run("preview", () => call<Preview>("POST", "/api/team/import", { mode: "preview", csv: text }));
    if (r.ok) {
      if (r.data.fatal) setError(r.data.fatal);
      else {
        setPreview(r.data);
        setMapping(r.data.mapping);
      }
    }
  }

  async function check() {
    const r = await run("dry", () => call<DryRun>("POST", "/api/team/import", { mode: "dry-run", csv, mapping, filename }));
    if (r.ok) {
      if (r.data.fatal) {
        setError(r.data.fatal);
        setDry(null);
      } else setDry(r.data);
    }
  }

  async function commit() {
    const r = await run("commit", () => call<{ created: number; updated: number; skipped: number }>("POST", "/api/team/import", { mode: "commit", csv, mapping, filename, skip_invalid: skip }));
    if (r.ok) {
      setResult(r.data);
      reset();
      loadHistory();
      onDone();
    }
  }

  const customCount = Object.values(mapping).filter((v) => v.startsWith("custom:")).length;

  return (
    <div className="space-y-8">
      <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="imp-h">
        <h2 id="imp-h" className="text-lg font-semibold">Import people from a CSV file</h2>
        <p className="max-w-2xl text-sm text-muted">
          Up to 5,000 people and 2 MB. Commas, semicolons or tabs all work. The first row must name the columns. Nothing is saved until you check the file and confirm. People are matched by email: existing ones are updated, new ones are added, and blank cells never erase what is already there.
        </p>
        <div>
          <label htmlFor="csv-file" className="mb-1 block text-sm text-muted">CSV file</label>
          <input id="csv-file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={pick} className="field w-full py-2.5" />
        </div>
        <Status error={error} notice={notice} />
        {result && (
          <p role="status" className="card border-l-4 p-4 text-sm">
            Import finished: {result.created} added, {result.updated} updated{result.skipped ? `, ${result.skipped} skipped because of errors` : ""}.
          </p>
        )}
      </section>

      {preview && (
        <section className="card space-y-5 p-4 sm:p-6" aria-labelledby="map-h">
          <div>
            <h2 id="map-h" className="text-lg font-semibold">Match the columns</h2>
            <p className="mt-1 text-sm text-muted">
              {filename}: {preview.totalRows} {preview.totalRows === 1 ? "person" : "people"}, columns separated by {DELIMITER_NAME[preview.delimiter] ?? "commas"}. We guessed the matches; change any that are wrong.
            </p>
          </div>
          <ul className="space-y-4">
            {preview.headers.map((h, i) => {
              const id = `map-${i}`;
              const value = mapping[i] ?? "";
              const samples = preview.sample.map((r) => r[i]).filter(Boolean).slice(0, 3);
              return (
                <li key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr] sm:items-center">
                  <div>
                    <p className="text-sm font-medium">{h || `Column ${i + 1}`}</p>
                    <p className="truncate text-xs text-muted" title={samples.join(", ")}>{samples.length ? `e.g. ${samples.join(", ")}` : "No values in the first rows"}</p>
                  </div>
                  <div>
                    <label htmlFor={id} className="sr-only">Use column {h || i + 1} as</label>
                    <select
                      id={id}
                      className="field w-full"
                      value={value.startsWith("custom:") ? "custom" : value}
                      onChange={(e) => {
                        setDry(null);
                        const v = e.target.value;
                        setMapping({ ...mapping, [i]: v === "custom" ? `custom:${customKeyFromHeader(h) || `field_${i + 1}`}` : v });
                      }}
                    >
                      <option value="">Do not import</option>
                      {Object.entries(PERSON_FIELDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      <option value="custom" disabled={customCount >= 10 && !value.startsWith("custom:")}>Custom field</option>
                    </select>
                    {value.startsWith("custom:") && (
                      <>
                        <label htmlFor={`${id}-key`} className="sr-only">Name of the custom field</label>
                        <input
                          id={`${id}-key`}
                          className="field mt-2 w-full"
                          value={value.slice(7)}
                          onChange={(e) => { setDry(null); setMapping({ ...mapping, [i]: `custom:${e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")}` }); }}
                          maxLength={30}
                          placeholder="field_name"
                        />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={check} disabled={busy === "dry"}>{busy === "dry" ? "Checking…" : "Check the file"}</button>
            <button type="button" className="btn" onClick={reset}>Start over</button>
          </div>
        </section>
      )}

      {dry && (
        <section className="card space-y-5 p-4 sm:p-6" aria-labelledby="dry-h">
          <h2 id="dry-h" className="text-lg font-semibold">Check result</h2>
          <p className="text-sm text-muted">Nothing has been saved yet.</p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Rows read" value={dry.totalRows} />
            <Tile label="Will be added" value={dry.creates} />
            <Tile label="Will be updated" value={dry.updates} />
            <Tile label="Rows with errors" value={dry.rowsWithErrors} bad={dry.rowsWithErrors > 0} />
          </dl>

          {dry.errors.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Problems found (row 1 is the header)</h3>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted"><tr className="border-b border-line"><th scope="col" className="p-2.5 font-medium">Row</th><th scope="col" className="p-2.5 font-medium">Field</th><th scope="col" className="p-2.5 font-medium">Problem</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {dry.errors.map((e, i) => (
                      <tr key={i}><td className="p-2.5 tabular-nums">{e.row}</td><td className="p-2.5">{e.field ? (PERSON_FIELDS as Record<string, string>)[e.field] ?? e.field : "Whole row"}</td><td className="p-2.5">{e.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dry.moreErrors > 0 && <p className="mt-2 text-sm text-muted">And {dry.moreErrors} more.</p>}
            </div>
          )}

          {dry.preview.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">First people to import</h3>
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {dry.preview.slice(0, 8).map((p) => (
                  <li key={p.row} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                    <span><span className="font-medium">{p.person.full_name}</span> <span className="break-all text-muted">{p.person.email}</span></span>
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs">{p.action === "create" ? "New" : "Update"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dry.rowsWithErrors > 0 && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              Import the {dry.validCount} good rows and skip the {dry.rowsWithErrors} with errors
            </label>
          )}
          <button type="button" className="btn btn-primary" onClick={commit} disabled={busy === "commit" || dry.validCount === 0 || (dry.rowsWithErrors > 0 && !skip)}>
            {busy === "commit" ? "Importing…" : `Import ${dry.validCount} ${dry.validCount === 1 ? "person" : "people"}`}
          </button>
        </section>
      )}

      <section aria-labelledby="hist-h" className="space-y-3">
        <h2 id="hist-h" className="text-lg font-semibold">Import history</h2>
        {history.length === 0 && <p className="text-sm text-muted">No imports yet.</p>}
        <ul className="divide-y divide-line rounded-2xl border border-line text-sm">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span><span className="font-medium break-all">{h.filename || "Untitled file"}</span> <span className="text-muted">{formatDate(h.created_at)}</span></span>
              <span className="text-muted">{h.created} added, {h.updated} updated{h.skipped ? `, ${h.skipped} skipped` : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${bad ? "text-red-600 dark:text-red-400" : ""}`}>{value}</dd>
    </div>
  );
}
