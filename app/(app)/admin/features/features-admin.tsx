"use client";

import { useState } from "react";
import { FEATURES, type Feature, type Role } from "@/lib/authz/roles";
import { ROLE_LABEL, Status, Switch, useSave } from "../use-save";

export type FlagRow = { feature: Feature; label: string; description: string; defaultEnabled: boolean; minRole: Role };
export type OverrideRow = { subjectType: "user" | "org"; subjectId: string; who: string; feature: Feature; enabled: boolean };
export type OrgRow = { id: string; name: string };

export function FeaturesAdmin({ flags, overrides, orgs, roles }: { flags: FlagRow[]; overrides: OverrideRow[]; orgs: OrgRow[]; roles: Role[] }) {
  const { busy, error, notice, save } = useSave();

  // add-exception form
  const [kind, setKind] = useState<"user" | "org">("user");
  const [email, setEmail] = useState("");
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [feature, setFeature] = useState<Feature>("animated_gif");
  const [enabled, setEnabled] = useState(true);

  const patch = (f: FlagRow, change: { default_enabled?: boolean; min_role?: Role }) =>
    save(`flag:${f.feature}`, "PATCH", "/api/admin/flags", { feature: f.feature, ...change }, `${f.label} updated.`);

  async function addException(e: React.FormEvent) {
    e.preventDefault();
    const body = kind === "user" ? { subject_type: "user", email, feature, enabled } : { subject_type: "org", org_id: orgId, feature, enabled };
    const ok = await save("add", "PUT", "/api/admin/overrides", body, `${FEATURES[feature]} turned ${enabled ? "on" : "off"} for ${kind === "user" ? email : "the organization"}.`);
    if (ok) setEmail("");
  }

  const removeException = (o: OverrideRow) =>
    save(`ov:${o.subjectType}:${o.subjectId}:${o.feature}`, "DELETE", "/api/admin/overrides", { subject_type: o.subjectType, subject_id: o.subjectId, feature: o.feature }, "Exception removed.");

  return (
    <div className="space-y-10">
      <Status error={error} notice={notice} />

      <section aria-labelledby="flags-h">
        <h2 id="flags-h" className="text-lg font-semibold">Features</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          A feature is available when it is switched on <em>and</em> the person&apos;s role is high enough. Exceptions below override both.
        </p>
        <div className="card mt-4 divide-y divide-line">
          {flags.map((f) => {
            const rowBusy = busy === `flag:${f.feature}`;
            return (
              <div key={f.feature} className="grid items-center gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[1fr_auto_13rem] sm:px-6">
                <div>
                  <p className="font-medium">{f.label}</p>
                  <p className="text-sm text-muted">{f.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted" aria-hidden="true">{f.defaultEnabled ? "On" : "Off"}</span>
                  <Switch checked={f.defaultEnabled} disabled={rowBusy} label={`${f.label}: on by default`} onChange={(v) => patch(f, { default_enabled: v })} />
                </div>
                <div>
                  <label className="sr-only" htmlFor={`min-${f.feature}`}>{f.label}: available to</label>
                  <select id={`min-${f.feature}`} className="field w-full" disabled={rowBusy} value={f.minRole} onChange={(e) => patch(f, { min_role: e.target.value as Role })}>
                    {roles.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="ex-h">
        <h2 id="ex-h" className="text-lg font-semibold">Exceptions</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Turn a feature on or off for one person or one organization, whatever their role. A person&apos;s exception beats their organization&apos;s. Use this to give a single client animated GIFs, for example.
        </p>

        <form onSubmit={addException} className="card mt-4 grid gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-[9rem_1fr_1fr_9rem_auto] lg:items-end">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="ex-kind">Applies to</label>
            <select id="ex-kind" className="field w-full" value={kind} onChange={(e) => setKind(e.target.value as "user" | "org")}>
              <option value="user">A person</option>
              <option value="org" disabled={orgs.length === 0}>An organization</option>
            </select>
          </div>
          <div>
            {kind === "user" ? (
              <>
                <label className="mb-1 block text-sm font-medium" htmlFor="ex-email">Email</label>
                <input id="ex-email" type="email" required className="field w-full" autoComplete="off" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </>
            ) : (
              <>
                <label className="mb-1 block text-sm font-medium" htmlFor="ex-org">Organization</label>
                <select id="ex-org" className="field w-full" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="ex-feature">Feature</label>
            <select id="ex-feature" className="field w-full" value={feature} onChange={(e) => setFeature(e.target.value as Feature)}>
              {flags.map((f) => (
                <option key={f.feature} value={f.feature}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="ex-enabled">Set to</label>
            <select id="ex-enabled" className="field w-full" value={enabled ? "on" : "off"} onChange={(e) => setEnabled(e.target.value === "on")}>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary min-h-11" disabled={busy === "add"}>
            {busy === "add" ? "Adding…" : "Add exception"}
          </button>
        </form>

        {overrides.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No exceptions yet. Everyone follows the defaults above.</p>
        ) : (
          <div className="card mt-4 divide-y divide-line">
            {overrides.map((o) => {
              const key = `ov:${o.subjectType}:${o.subjectId}:${o.feature}`;
              return (
                <div key={key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{o.who}</p>
                    <p className="text-sm text-muted">
                      {o.subjectType === "org" ? "Organization" : "Person"} · {FEATURES[o.feature]} · <strong className="font-medium text-ink">{o.enabled ? "On" : "Off"}</strong>
                    </p>
                  </div>
                  <button type="button" className="btn min-h-11" disabled={busy === key} onClick={() => removeException(o)} aria-label={`Remove exception: ${FEATURES[o.feature]} for ${o.who}`}>
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
