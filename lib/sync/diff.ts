import {
  CUSTOM_KEY,
  CUSTOM_MAX,
  FIELD_MAX,
  MAX_CUSTOM,
  TEXT_FIELDS,
  type DirectoryFetch,
  type DirectorySource,
  type ExistingPerson,
  type FieldChange,
  type FieldPolicy,
  type Plan,
  type PlanStats,
  type PlanUpdate,
  type Policy,
  type SyncWarning,
} from "./types";

/**
 * THE RULE for who wins, per field (documented in docs/directory-and-crm-sync.md):
 *
 *   incoming value is the same as the directory's      -> nothing to do
 *   incoming value is blank
 *       field policy "source" AND the admin ticked "blank values may erase" AND the directory has a value -> erase it
 *       otherwise                                      -> keep the directory value (a blank never erases by default)
 *   incoming value has text
 *       field policy "source"                          -> overwrite the directory value
 *       field policy "directory"                       -> fill it only when the directory value is blank
 *
 * "directory" therefore means "what someone typed into SignCraft wins over the sync"; "source" means "the sync wins".
 */
export function decide(policy: Policy, incoming: string, current: string, allowBlankOverwrite: boolean, canBeBlank = true): string | null {
  if (incoming === current) return null;
  if (incoming === "") return policy === "source" && allowBlankOverwrite && canBeBlank && current !== "" ? "" : null;
  if (policy === "source") return incoming;
  return current === "" ? incoming : null;
}

const norm = (s: string) => s.trim();

export type DirectoryDiffInput = {
  source: DirectorySource;
  fetched: DirectoryFetch;
  existing: ExistingPerson[];
  policy: FieldPolicy;
  allowBlankOverwrite: boolean;
};

export function diffDirectory(o: DirectoryDiffInput): { plan: Plan; stats: PlanStats } {
  const pol = (f: string): Policy => o.policy[f] ?? "source";
  const warnings: SyncWarning[] = [...o.fetched.warnings];
  const byEmail = new Map(o.existing.map((p) => [p.email.toLowerCase(), p]));
  const byExt = new Map<string, ExistingPerson>();
  for (const p of o.existing) if (p.source === o.source && p.external_id) byExt.set(p.external_id, p);

  const plan: Plan = { creates: [], updates: [], deactivates: [], unchanged: 0, warnings };
  const matched = new Set<string>();
  const claimedEmails = new Set<string>(); // emails the source users in this run end up with
  let skipped = o.fetched.skipped;
  let erasures = 0;

  for (const u of o.fetched.users) {
    const email = u.email.toLowerCase();
    if (claimedEmails.has(email)) {
      warnings.push({ who: email, message: "Two accounts in the source use this email. Only the first is used." });
      skipped++;
      continue;
    }
    let person = byExt.get(u.external_id);
    let byId = true;
    if (!person) {
      person = byEmail.get(email);
      byId = false;
    }
    if (person && matched.has(person.id)) {
      warnings.push({ who: email, message: "This person is already matched to another account in the source. Skipped." });
      skipped++;
      continue;
    }

    if (!person) {
      if (u.status === "inactive") {
        skipped++; // a disabled account that was never in the directory is not added
        continue;
      }
      claimedEmails.add(email);
      plan.creates.push({ email, external_id: u.external_id, full_name: u.full_name, first_name: u.first_name, last_name: u.last_name, title: u.title, department: u.department, phone: u.phone, mobile: u.mobile, location: u.location });
      continue;
    }

    matched.add(person.id);
    claimedEmails.add(email);
    const set: Record<string, string> = {};
    const changes: FieldChange[] = [];
    let erases = false;

    // identity: an account that kept its id but got a new address moves the address (unless someone else already has it)
    if (byId && email !== person.email.toLowerCase()) {
      const other = byEmail.get(email);
      if (other && other.id !== person.id) warnings.push({ who: email, message: `The address changed in the source but ${other.email} is already another person in the directory. The address was left alone.` });
      else {
        set.email = email;
        changes.push({ field: "email", from: person.email, to: email });
      }
    }
    // an entry added by hand (or imported from a file) is linked to this source the first time it matches by email
    if (!byId && person.source !== o.source && !person.external_id) {
      set.source = o.source;
      set.external_id = u.external_id;
      changes.push({ field: "source", from: person.source, to: o.source });
    }

    for (const f of TEXT_FIELDS) {
      const next = decide(pol(f), norm(u[f]), person[f], o.allowBlankOverwrite, f !== "full_name");
      if (next === null) continue;
      set[f] = next;
      changes.push({ field: f, from: person[f], to: next });
      if (next === "") erases = true;
    }
    // status follows the account only when the source wins this field; "directory" turns automatic (de)activation off
    if (pol("status") === "source" && u.status !== person.status) {
      set.status = u.status;
      changes.push({ field: "status", from: person.status, to: u.status });
    }

    if (changes.length === 0) {
      plan.unchanged++;
      continue;
    }
    if (erases) erasures++;
    plan.updates.push({ person_id: person.id, email: person.email, name: person.full_name, set, custom_set: {}, custom_remove: [], changes });
  }

  // people who came from this source but are no longer in it: inactive, never deleted
  if (pol("status") === "source") {
    for (const p of o.existing) {
      if (p.source === o.source && p.external_id && p.status === "active" && !o.fetched.seenIds.has(p.external_id)) {
        plan.deactivates.push({ person_id: p.id, email: p.email, name: p.full_name });
      }
    }
  }

  const base = o.existing.filter((p) => p.source === o.source && p.external_id && p.status === "active").length;
  const stats: PlanStats = {
    fetched: o.fetched.users.length,
    creates: plan.creates.length,
    updates: plan.updates.length,
    deactivates: plan.deactivates.length,
    unchanged: plan.unchanged,
    skipped,
    erasures,
    base,
  };
  return { plan, stats };
}

/* ------------------------------------------------------------------------------- CRM */

export type CrmDiffInput = {
  /** Mapped values per lower-cased email. Every mapped target is present; "" means the CRM has nothing. */
  records: Map<string, Record<string, string>>;
  people: ExistingPerson[];
  policy: FieldPolicy;
  /** Used for a target with no explicit policy. CRM sync defaults to "directory" (fill blanks only) so nothing is overwritten by accident. */
  defaultPolicy: Policy;
  allowBlankOverwrite: boolean;
  fetchedWarnings?: SyncWarning[];
};

export function diffCrm(o: CrmDiffInput): { plan: Plan; stats: PlanStats } {
  const pol = (f: string): Policy => o.policy[f] ?? o.defaultPolicy;
  const warnings: SyncWarning[] = [...(o.fetchedWarnings ?? [])];
  const plan: Plan = { creates: [], updates: [], deactivates: [], unchanged: 0, warnings };
  let matched = 0;
  let notFound = 0;
  let erasures = 0;
  let skipped = warnings.length;

  for (const p of o.people) {
    if (p.status !== "active") continue;
    const rec = o.records.get(p.email.toLowerCase());
    if (!rec) {
      notFound++;
      continue;
    }
    matched++;
    const set: Record<string, string> = {};
    const customSet: Record<string, string> = {};
    const customRemove: string[] = [];
    const changes: FieldChange[] = [];
    let erases = false;
    let customCount = Object.keys(p.custom).length;

    for (const [target, incoming] of Object.entries(rec)) {
      if (target.startsWith("custom.")) {
        const key = target.slice(7);
        if (!CUSTOM_KEY.test(key) || incoming.length > CUSTOM_MAX) continue; // the fetcher already warned
        const cur = p.custom[key] ?? "";
        const next = decide(pol(target), incoming, cur, o.allowBlankOverwrite);
        if (next === null) continue;
        if (next === "") {
          customRemove.push(key);
          customCount--;
          erases = true;
        } else {
          if (cur === "") {
            if (customCount >= MAX_CUSTOM) {
              warnings.push({ who: p.email, message: `Could not add the custom field "${key}": a person can have at most ${MAX_CUSTOM}.` });
              skipped++;
              continue;
            }
            customCount++;
          }
          customSet[key] = next;
        }
        changes.push({ field: target, from: cur, to: next });
      } else if ((TEXT_FIELDS as readonly string[]).includes(target)) {
        const f = target as (typeof TEXT_FIELDS)[number];
        if (incoming.length > FIELD_MAX[f]) continue;
        const next = decide(pol(f), incoming, p[f], o.allowBlankOverwrite, f !== "full_name");
        if (next === null) continue;
        set[f] = next;
        changes.push({ field: f, from: p[f], to: next });
        if (next === "") erases = true;
      }
    }
    if (changes.length === 0) {
      plan.unchanged++;
      continue;
    }
    if (erases) erasures++;
    const upd: PlanUpdate = { person_id: p.id, email: p.email, name: p.full_name, set, custom_set: customSet, custom_remove: customRemove, changes };
    plan.updates.push(upd);
  }

  const stats: PlanStats = {
    fetched: matched,
    creates: 0,
    updates: plan.updates.length,
    deactivates: 0,
    unchanged: plan.unchanged,
    skipped,
    erasures,
    base: o.people.filter((p) => p.status === "active").length,
    not_found: notFound,
  };
  return { plan, stats };
}

/** The same cap the database enforces, for showing the reason before an admin presses Apply. Returns null when the run is allowed. */
export function safetyProblem(source: "directory" | "crm", stats: PlanStats, capPercent: number): string | null {
  if (stats.fetched === 0) return source === "crm" ? "Refused: the CRM returned no matching records, so there is nothing to apply." : "Refused: the source returned no users. An empty answer is treated as a failure, never as everyone having left.";
  const risky = source === "crm" ? stats.erasures : stats.deactivates;
  if (risky > 0 && risky * 100 > capPercent * stats.base) {
    const pct = Math.round((risky * 100) / Math.max(stats.base, 1));
    return `Refused by the safety cap: this would ${source === "crm" ? "erase values for" : "deactivate"} ${risky} of ${stats.base} people (${pct} percent), more than the allowed ${capPercent} percent. Check the source, or raise the cap in Settings if this is really intended.`;
  }
  return null;
}
