"use client";

import { useState } from "react";
import { ROLES, type Role } from "@/lib/authz/roles";
import { ROLE_NAME, Status, useSave } from "../use-save";
import { Select } from "@/components/ui/select";

export type Invitation = { email: string; role: Role; invited: string; accepted: string | null };

/** Fixed locale and time zone, so the server and the browser print the same text. */
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export function InvitationsAdmin({ invitations }: { invitations: Invitation[] }) {
  const { busy, error, notice, save } = useSave();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (await save("invite", "PUT", "/api/admin/invitations", { email: address, role }, `${address} can now create an account. Tell them to use the login page.`)) setEmail("");
  }

  const open = invitations.filter((i) => !i.accepted);
  const used = invitations.filter((i) => i.accepted);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Invitations</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Sign-up is by invitation only. Add someone&apos;s email address here, then tell them to open the login page and choose &ldquo;Invited? Create your account&rdquo;. They confirm their email, and they get the role you pick.
        </p>
      </header>

      <form onSubmit={invite} className="card grid gap-3 p-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end sm:p-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-email" className="text-sm font-medium">Email address</label>
          <input id="invite-email" type="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium">Role</label>
          <Select id="invite-role" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_NAME[r]}</option>
            ))}
          </Select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy === "invite"}>{busy === "invite" ? "Please wait…" : "Invite"}</button>
      </form>
      <Status error={error} notice={notice} />

      <section aria-labelledby="open-heading" className="space-y-2">
        <h2 id="open-heading" className="text-lg font-semibold">Waiting to sign up</h2>
        <div className="card divide-y divide-line">
          {open.length === 0 && <p className="p-6 text-sm text-muted">No open invitations.</p>}
          {open.map((i) => (
            <div key={i.email} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="truncate font-medium">{i.email}</p>
                <p className="text-sm text-muted">{ROLE_NAME[i.role]} · invited {formatDate(i.invited)}</p>
              </div>
              <button type="button" className="btn min-h-11" disabled={busy === i.email} onClick={() => save(i.email, "DELETE", "/api/admin/invitations", { email: i.email }, `Invitation for ${i.email} withdrawn.`)}>
                Withdraw
              </button>
            </div>
          ))}
        </div>
      </section>

      {used.length > 0 && (
        <section aria-labelledby="used-heading" className="space-y-2">
          <h2 id="used-heading" className="text-lg font-semibold">Joined</h2>
          <div className="card divide-y divide-line">
            {used.map((i) => (
              <div key={i.email} className="px-4 py-3 sm:px-6">
                <p className="truncate font-medium">{i.email}</p>
                <p className="text-sm text-muted">{ROLE_NAME[i.role]} · joined {formatDate(i.accepted as string)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
