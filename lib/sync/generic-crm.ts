import { clean, SyncError, Warnings } from "./errors";
import { GENERIC_SECRET_ENV, type GenericConfigT } from "./crm-config";
import { listPaths, pickPath } from "./jsonpath";
import { safeGetJson, type Resolver, type Transport } from "./safe-fetch";
import { CUSTOM_MAX, FIELD_MAX, type TextField } from "./types";

/**
 * The generic REST adapter for a CRM whose API we do not know (the "Kimp CRM"). The admin configures a base URL, the name of the
 * auth header, a path template with {email}, and a JSON path per people field. The secret comes from the server environment
 * (KIMP_CRM_SECRET) and is sent as `<auth_prefix><secret>` in the configured header; it is never stored in the database, never sent
 * to the browser and never part of any error message. Every request goes through safeGetJson (SSRF defence, see safe-fetch.ts).
 *
 * BUILT, NOT VERIFIED against the real Kimp CRM (its API is unknown to us). Tested against fakes.
 */

type Env = Record<string, string | undefined>;
export type GenericDeps = { env?: Env; resolve?: Resolver; transport?: Transport };

export function genericMissing(env: Env = process.env): string[] {
  const s = env[GENERIC_SECRET_ENV] ?? "";
  return s.trim() && s.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(s) ? [] : [GENERIC_SECRET_ENV];
}

/** The URL for one person: base + path template with {email} URL-encoded. Always on the base URL's own origin. */
export function buildUrl(cfg: GenericConfigT, email: string): string | null {
  try {
    const base = new URL(cfg.base_url);
    const url = new URL(cfg.base_url.replace(/\/+$/, "") + cfg.path_template.replaceAll("{email}", encodeURIComponent(email)));
    return url.origin === base.origin && url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export type MappedRow = { from: string; to: string; found: boolean; value: string; note: string };
export type RecordResult =
  | { kind: "found"; values: Record<string, string>; rows: MappedRow[]; json: unknown }
  | { kind: "not_found" };

/** Fetch and map one person. Throws SyncError for problems that make every call pointless (secret missing, 401/403, blocked URL). */
export async function fetchGenericOne(cfg: GenericConfigT, email: string, deps: GenericDeps = {}): Promise<RecordResult> {
  const env = deps.env ?? process.env;
  if (genericMissing(env).length) throw new SyncError("not_configured", `The CRM secret is not set. Missing: ${GENERIC_SECRET_ENV}.`);
  const url = buildUrl(cfg, email);
  if (!url) throw new SyncError("bad_config", "The base address and path do not make a valid https address.");
  const r = await safeGetJson(url, { headers: { [cfg.auth_header]: `${cfg.auth_prefix}${env[GENERIC_SECRET_ENV]}` }, resolve: deps.resolve, transport: deps.transport });
  if (!r.ok) {
    if (/server answered 404/.test(r.reason)) return { kind: "not_found" };
    if (/server answered 40[13]/.test(r.reason)) throw new SyncError("not_authorized", `The CRM refused the credentials (${r.reason.replace("The server answered ", "HTTP ")}). Check ${GENERIC_SECRET_ENV}, the header name and the prefix.`);
    if (/not allowed|private|internal|redirect|resolved/i.test(r.reason)) throw new SyncError("blocked", r.reason);
    throw new SyncError("upstream", `The CRM request failed: ${r.reason}`);
  }
  const rows: MappedRow[] = [];
  const values: Record<string, string> = {};
  for (const m of cfg.mapping) {
    const p = pickPath(r.json, m.from);
    if (!p.found) {
      // a path that is not in the answer leaves the field alone (a typo in the mapping must never erase anything)
      rows.push({ from: m.from, to: m.to, found: false, value: "", note: p.reason });
      continue;
    }
    const v = clean(p.value);
    const max = m.to.startsWith("custom.") ? CUSTOM_MAX : FIELD_MAX[m.to as TextField];
    if (v.length > max) {
      rows.push({ from: m.from, to: m.to, found: true, value: "", note: `Ignored: ${v.length} characters, the field allows ${max}.` });
      continue;
    }
    rows.push({ from: m.from, to: m.to, found: true, value: v, note: v ? "" : "The CRM has an empty value here." });
    values[m.to] = v;
  }
  return { kind: "found", values, rows, json: r.json };
}

/** The test button: one record, exactly what would be mapped, plus the paths in the answer to help write the mapping. */
export async function testGeneric(cfg: GenericConfigT, email: string, deps: GenericDeps = {}) {
  const r = await fetchGenericOne(cfg, email, deps);
  if (r.kind === "not_found") return { found: false as const, rows: [] as MappedRow[], paths: [] as { path: string; sample: string }[] };
  return { found: true as const, rows: r.rows, paths: listPaths(r.json) };
}

/** All people, 4 requests at a time, with a time budget. A person the CRM does not know is simply not in the result. */
export async function fetchGenericAll(cfg: GenericConfigT, emails: string[], deps: GenericDeps = {}, budgetMs = 240_000) {
  const records = new Map<string, Record<string, string>>();
  const w = new Warnings();
  const deadline = Date.now() + budgetMs;
  let failed = 0;
  let done = 0;
  let i = 0;
  let fatal: SyncError | null = null;
  const worker = async () => {
    while (!fatal) {
      const idx = i++;
      if (idx >= emails.length) return;
      if (Date.now() > deadline) return;
      const email = emails[idx];
      try {
        const r = await fetchGenericOne(cfg, email, deps);
        if (r.kind === "found") records.set(email, r.values);
        done++;
      } catch (e) {
        if (e instanceof SyncError && e.code === "upstream") {
          failed++;
          done++;
          w.add(email, "The CRM request failed; this person was left alone.");
          if (failed >= 10 && failed * 5 > done) fatal = new SyncError("upstream", "The CRM failed for more than a fifth of the people. Nothing was applied.");
        } else fatal = e instanceof SyncError ? e : new SyncError("upstream", "Unexpected CRM error.");
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (fatal) throw fatal;
  if (done < emails.length) w.add("(all)", `Stopped after ${done} of ${emails.length} people because of the time limit. The rest were not looked up.`);
  return { records, warnings: w.list, skipped: w.count };
}
