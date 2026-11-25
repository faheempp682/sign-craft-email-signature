import { clean, readJson, SyncError, timedFetch, Warnings } from "./errors";
import { HUBSPOT_TOKEN_ENV, type HubspotConfigT } from "./crm-config";
import { CUSTOM_MAX, FIELD_MAX, type TextField } from "./types";

/**
 * HubSpot via a private app access token (HUBSPOT_ACCESS_TOKEN), keyed by the person's email.
 *
 * Sources (read 2026):
 *  - Contacts batch read: POST https://api.hubapi.com/crm/v3/objects/contacts/batch/read with
 *    { properties: [...], idProperty: "email", inputs: [{ id: "<email>" }] }, at most 100 inputs per call (idProperty is required to look up by email).
 *    The answer is { status, results: [{ id, properties: {...} }], errors?: [...] }; HubSpot answers 207 when some inputs were not found.
 *    https://developers.hubspot.com/docs/api/crm/contacts
 *  - Standard contact properties: phone, mobilephone, jobtitle, email, firstname, lastname (same page); custom properties use their internal name.
 *  - Owners: GET https://api.hubapi.com/crm/v3/owners?limit=100&after=<cursor> answers { results: [{ id, email, firstName, lastName, userId, archived }], paging: { next: { after } } }.
 *    The contact property hubspot_owner_id holds the owner id. https://developers.hubspot.com/docs/api/crm/owners
 *  - Private app scopes: crm.objects.contacts.read, and crm.objects.owners.read when owner_name / owner_email are mapped.
 *
 * BUILT, NOT VERIFIED against a real HubSpot account (no token in development); tested against fakes with these shapes.
 */

type Env = Record<string, string | undefined>;
const HOST = "https://api.hubapi.com";
const BATCH = 100;

export const hubspotMissing = (env: Env = process.env): string[] => ((env[HUBSPOT_TOKEN_ENV] ?? "").trim() && !/[\s]/.test((env[HUBSPOT_TOKEN_ENV] ?? "").trim()) ? [] : [HUBSPOT_TOKEN_ENV]);

type Owner = { id: string; email: string; name: string };

async function hs(fetchFn: typeof fetch, token: string, path: string, init: RequestInit = {}, retry = true): Promise<unknown> {
  const res = await timedFetch(fetchFn, `${HOST}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) } }, "HubSpot");
  if (res.status === 429 && retry) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 10);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return hs(fetchFn, token, path, init, false);
  }
  if (res.status === 401) throw new SyncError("not_authorized", "HubSpot rejected the access token. It may be wrong, revoked or expired: create a new private app token and update HUBSPOT_ACCESS_TOKEN.");
  if (res.status === 403) throw new SyncError("not_authorized", "HubSpot refused. The private app needs the scopes crm.objects.contacts.read (and crm.objects.owners.read for owner fields).");
  if (res.status === 429) throw new SyncError("upstream", "HubSpot is rate limiting this app. Please try again in a few minutes.");
  // 207 (multi-status) is a normal answer to a batch read where some emails are unknown
  if (res.status !== 200 && res.status !== 207) throw new SyncError("upstream", "HubSpot could not answer right now. Please try again in a moment.");
  return readJson(res, "HubSpot");
}

async function loadOwners(fetchFn: typeof fetch, token: string): Promise<Map<string, Owner>> {
  const out = new Map<string, Owner>();
  let after = "";
  for (let page = 0; page < 30; page++) {
    const body = (await hs(fetchFn, token, `/crm/v3/owners?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`)) as { results?: { id?: unknown; email?: unknown; firstName?: unknown; lastName?: unknown }[]; paging?: { next?: { after?: unknown } } };
    for (const o of body.results ?? []) {
      if (typeof o?.id === "string" || typeof o?.id === "number") {
        const id = String(o.id);
        out.set(id, { id, email: clean(o.email), name: `${clean(o.firstName)} ${clean(o.lastName)}`.trim() });
      }
    }
    const next = body.paging?.next?.after;
    if (typeof next !== "string" || !next) return out;
    after = next;
  }
  throw new SyncError("too_large", "HubSpot has more owners than we will read.");
}

export async function fetchHubspot(cfg: HubspotConfigT, emails: string[], o: { env?: Env; fetchFn?: typeof fetch } = {}) {
  const env = o.env ?? process.env;
  const fetchFn = o.fetchFn ?? fetch;
  if (hubspotMissing(env).length) throw new SyncError("not_configured", `HubSpot is not set up. Missing: ${HUBSPOT_TOKEN_ENV}.`);
  const token = env[HUBSPOT_TOKEN_ENV]!.trim();
  const needOwner = cfg.mapping.some((m) => m.from === "owner_name" || m.from === "owner_email");
  const props = new Set<string>(["email"]);
  for (const m of cfg.mapping) if (m.from !== "owner_name" && m.from !== "owner_email") props.add(m.from);
  if (needOwner) props.add("hubspot_owner_id");
  const owners = needOwner ? await loadOwners(fetchFn, token) : new Map<string, Owner>();

  const records = new Map<string, Record<string, string>>();
  const w = new Warnings();
  for (let i = 0; i < emails.length; i += BATCH) {
    const chunk = emails.slice(i, i + BATCH);
    const body = (await hs(fetchFn, token, "/crm/v3/objects/contacts/batch/read", { method: "POST", body: JSON.stringify({ properties: [...props], idProperty: "email", inputs: chunk.map((id) => ({ id })) }) })) as { results?: { properties?: Record<string, unknown> }[] };
    if (body.results !== undefined && !Array.isArray(body.results)) throw new SyncError("upstream", "HubSpot answered in a shape we do not recognise.");
    for (const r of body.results ?? []) {
      const p = r?.properties ?? {};
      const email = clean(p.email).toLowerCase();
      if (!email) continue;
      const values: Record<string, string> = {};
      for (const m of cfg.mapping) {
        let v = "";
        if (m.from === "owner_name" || m.from === "owner_email") {
          const ow = owners.get(String(p.hubspot_owner_id ?? ""));
          v = ow ? (m.from === "owner_name" ? ow.name : ow.email) : "";
        } else v = clean(typeof p[m.from] === "string" || typeof p[m.from] === "number" ? String(p[m.from]) : "");
        const max = m.to.startsWith("custom.") ? CUSTOM_MAX : FIELD_MAX[m.to as TextField];
        if (v.length > max) {
          w.add(email, `The value for ${m.to} is ${v.length} characters (limit ${max}) and was ignored.`);
          continue; // left out, so it can never erase the directory value
        }
        values[m.to] = v;
      }
      records.set(email, values);
    }
  }
  return { records, warnings: w.list, skipped: w.count };
}
