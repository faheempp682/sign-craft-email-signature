"use client";

import { useState } from "react";
import { UserPlusRoundedIcon } from "@solar-icons/react/linear/user-plus-rounded";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ROLES, type Role } from "@/lib/authz/roles";
import { ROLE_NAME } from "@/app/(app)/admin/use-save";

type Result = { ok: true; emailed: boolean; link: string; email: string } | { ok: false; error: string };

/** Sidebar-footer "Invite" button: opens a dialog, the admin types an email, and the person is sent a link to set their password. */
export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setResult({ ok: false, error: body?.error?.message ?? body?.message ?? "Could not send the invitation." });
      else setResult({ ok: true, emailed: !!body.emailed, link: body.link, email: body.email });
    } catch {
      setResult({ ok: false, error: "Network error. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setResult(null); setEmail(""); setRole("member"); setCopied(false); } }}>
      <DialogTrigger asChild>
        <button type="button" title="Invite" aria-label="Invite someone" className="mt-2 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-brand text-sm font-semibold text-white transition-colors hover:brightness-110">
          <UserPlusRoundedIcon size={17} />
          <span className="hidden lg:inline">Invite</span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>They get a link by email. It lets them sign in, set their own password and start using SignCraft.</DialogDescription>
        </DialogHeader>
        {result?.ok ? (
          <div className="grid gap-3 text-sm">
            <p role="status">
              {result.emailed ? `Invitation emailed to ${result.email}.` : `${result.email} can now join, but no email was sent (email sending is not set up). Share this link with them:`}
            </p>
            <div className="flex gap-2">
              <input readOnly value={result.link} aria-label="Invite link" className="field min-w-0 flex-1" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={() => navigator.clipboard?.writeText(result.link).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            <label htmlFor="invite-dialog-email" className="text-sm font-medium">Email address</label>
            <input id="invite-dialog-email" type="email" required autoFocus autoComplete="off" className="field" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="invite-dialog-role" className="text-sm font-medium">Role</label>
            <select id="invite-dialog-role" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
            </select>
            {result && !result.ok && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{result.error}</p>}
            <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send invite"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
