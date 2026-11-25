"use client";

import { ROLES, type Role } from "@/lib/authz/roles";
import { ROLE_NAME, Status, useSave } from "../use-save";

export type Person = { email: string; joined: string; role: Role; always: boolean };

/** Fixed locale and time zone, so the server and the browser print the same text (a locale-dependent date breaks hydration). */
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export function UsersAdmin({ orgName, people }: { orgName: string; people: Person[] }) {
  const { busy, error, notice, save } = useSave();

  const setRole = (p: Person, role: Role) => save(p.email, "PUT", "/api/admin/members", { email: p.email, role }, `${p.email} is now ${ROLE_NAME[role].toLowerCase()}.`);

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted">
        People appear here after they sign in once. Roles apply across {orgName}: <strong className="font-medium text-ink">Members</strong> use the editor and limited AI, <strong className="font-medium text-ink">Designers</strong> get higher AI limits and custom HTML,{" "}
        <strong className="font-medium text-ink">Admins</strong> manage everything on this page.
      </p>
      <Status error={error} notice={notice} />

      <div className="card divide-y divide-line">
        {people.length === 0 && <p className="p-6 text-sm text-muted">No one has signed in yet.</p>}
        {people.map((p) => (
          <div key={p.email} className="grid items-center gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[1fr_11rem] sm:px-6">
            <div className="min-w-0">
              <p className="truncate font-medium">{p.email}</p>
              <p className="text-sm text-muted">
                Joined {formatDate(p.joined)}
                {p.always && " · always an admin (listed in ADMIN_EMAILS)"}
              </p>
            </div>
            <div>
              <label className="sr-only" htmlFor={`role-${p.email}`}>Role for {p.email}</label>
              <select
                id={`role-${p.email}`}
                className="field w-full"
                value={p.role}
                disabled={busy === p.email || p.always}
                onChange={(e) => setRole(p, e.target.value as Role)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_NAME[r]}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
