"use client";

import { useState } from "react";
import { FEATURES, ROLES, type Feature } from "@/lib/authz/roles";
import { describeLimit, type PlanView } from "@/lib/plans";
import { ROLE_NAME, Status, useSave } from "../use-save";

export type OrgPlanRow = { id: string; name: string; planId: string | null; client: boolean };

export function PlansAdmin({ plans, orgs }: { plans: PlanView[]; orgs: OrgPlanRow[] }) {
  const { busy, error, notice, save } = useSave();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const value = (o: OrgPlanRow) => draft[o.id] ?? o.planId ?? "";
  const shown = plans.find((p) => p.id === open);

  return (
    <div className="space-y-10">
      <Status error={error} notice={notice} />
      <p className="max-w-2xl text-sm text-muted">
        A plan is a preset of features and AI limits that an admin assigns to an organization. <strong>Nothing is charged</strong>: there is no billing in SignCraft.
        An organization with no plan behaves exactly as before, and exceptions on the Features screen still override a plan.
      </p>

      <section aria-labelledby="assign-h">
        <h2 id="assign-h" className="text-lg font-semibold">Organizations</h2>
        <ul className="card mt-3 divide-y divide-line">
          {orgs.map((o) => (
            <li key={o.id} className="grid items-end gap-3 px-4 py-3 sm:grid-cols-[1fr_14rem_auto] sm:px-6">
              <p className="font-medium sm:pb-2.5">
                {o.name}
                {o.client && <span className="ml-2 text-xs font-normal text-muted">client</span>}
              </p>
              <div>
                <label className="mb-1 block text-sm text-muted" htmlFor={`plan-${o.id}`}>Plan for {o.name}</label>
                <select id={`plan-${o.id}`} className="field w-full" value={value(o)} onChange={(e) => setDraft({ ...draft, [o.id]: e.target.value })}>
                  <option value="">No plan (as before)</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="btn btn-primary min-h-11"
                disabled={value(o) === (o.planId ?? "") || busy === o.id}
                aria-label={`Save plan for ${o.name}`}
                onClick={() => void save(o.id, "PUT", "/api/plans/assign", { org_id: o.id, plan_id: value(o) || null }, `${o.name}: plan saved.`)}
              >
                {busy === o.id ? "Saving…" : "Save"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="presets-h">
        <h2 id="presets-h" className="text-lg font-semibold">Presets</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {plans.map((p) => (
            <div key={p.id} className="card p-4 sm:px-6">
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted">{p.description}</p>
              <button type="button" className="btn mt-3 min-h-11" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                {open === p.id ? "Hide details" : `Details for ${p.name}`}
              </button>
            </div>
          ))}
        </div>
        {shown && (
          <div className="card mt-4 space-y-5 p-4 sm:px-6" role="region" aria-label={`${shown.name} plan details`}>
            <div>
              <h3 className="font-semibold">Features</h3>
              <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                {(Object.keys(FEATURES) as Feature[]).map((f) => (
                  <li key={f} className="rounded-full border border-line px-3 py-1">
                    {FEATURES[f]}: {shown.features[f] === undefined ? "flag default" : shown.features[f] ? "on" : "off"}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted">A feature a plan turns on still needs the role that feature requires.</p>
            </div>
            <div>
              <h3 className="font-semibold">AI limits (per person)</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="border-b border-line text-muted">
                    <tr>
                      <th className="py-2 pr-2 font-medium">Feature</th>
                      {ROLES.map((r) => (
                        <th key={r} className="px-2 py-2 font-medium">{ROLE_NAME[r]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[...new Set(shown.limits.map((l) => l.feature))].map((f) => (
                      <tr key={f}>
                        <td className="py-2 pr-2">{FEATURES[f]}</td>
                        {ROLES.map((r) => {
                          const l = shown.limits.find((x) => x.feature === f && x.role === r);
                          return <td key={r} className="px-2 py-2">{l ? describeLimit(l) : "Standard limits"}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
