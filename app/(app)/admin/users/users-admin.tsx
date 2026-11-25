"use client";

import { useEffect, useRef, useState } from "react";
import { ROLES, type Role } from "@/lib/authz/roles";
import { ROLE_NAME, Status, useSave } from "../use-save";

export type Person = { email: string; joined: string; role: Role; always: boolean };
export type PendingInvite = { email: string; role: Role; invited: string };

/** Fixed locale and time zone, so the server and the browser print the same text (a locale-dependent date breaks hydration). */
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export function UsersAdmin({ orgName, people, pending = [] }: { orgName: string; people: Person[]; pending?: PendingInvite[] }) {
  const { busy, error, notice, save } = useSave();
  const [inviting, setInviting] = useState(false);

  const setRole = (p: Person, role: Role) => save(p.email, "PUT", "/api/admin/members", { email: p.email, role }, `${p.email} is now ${ROLE_NAME[role].toLowerCase()}.`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted">
          People appear here after they sign in once. Roles apply across {orgName}: <strong className="font-medium text-ink">Members</strong> use the editor and limited AI, <strong className="font-medium text-ink">Designers</strong> get higher AI limits and custom HTML,{" "}
          <strong className="font-medium text-ink">Admins</strong> manage everything on this page.
        </p>
        <button type="button" className="btn btn-primary min-h-11" onClick={() => setInviting(true)}>Invite people</button>
      </div>
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

      {pending.length > 0 && (
        <section aria-labelledby="pending-heading" className="space-y-2">
          <h2 id="pending-heading" className="text-lg font-semibold">Waiting to sign up</h2>
          <div className="card divide-y divide-line">
            {pending.map((i) => (
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
      )}

      <InviteDialog open={inviting} onClose={() => setInviting(false)} orgName={orgName} />
    </div>
  );
}

function InviteDialog({ open, onClose, orgName }: { open: boolean; onClose: () => void; orgName: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { busy, error, save } = useSave();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (await save("invite", "PUT", "/api/admin/invitations", { email: address, role }, `${address} can now create an account.`)) {
      setEmail("");
      setRole("member");
      onClose();
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="invite-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <form onSubmit={invite} className="space-y-4 p-6">
        <div>
          <h2 id="invite-title" className="text-lg font-semibold">Invite someone to {orgName}</h2>
          <p className="mt-1 text-sm text-muted">
            Sign-up is by invitation only. After you invite them, tell them to open the login page and choose &ldquo;Invited? Create your account&rdquo;.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-email" className="text-sm font-medium">Email address</label>
          <input id="invite-email" type="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium">Role</label>
          <select id="invite-role" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_NAME[r]}</option>
            ))}
          </select>
        </div>
        <div aria-live="polite" className="min-h-5 text-sm text-red-600 dark:text-red-400">{error}</div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn min-h-11" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary min-h-11" disabled={busy === "invite"}>{busy === "invite" ? "Please wait…" : "Send invite"}</button>
        </div>
      </form>
    </dialog>
  );
}
