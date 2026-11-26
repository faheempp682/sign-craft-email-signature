"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { PasswordInput } from "@/components/password-input";

type Result = { ok: boolean; text: string } | null;

function Status({ r }: { r: Result }) {
  return (
    <div role="status" aria-live="polite">
      {r && <p className={r.ok ? "text-sm text-accent" : "text-sm text-red-700 dark:text-red-300"}>{r.text}</p>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-4 p-6">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function SettingsForms({ email, name, avatarUrl, hasPassword }: { email: string; name: string; avatarUrl: string; hasPassword: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!), []);

  const [fullName, setFullName] = useState(name);
  const [nameR, setNameR] = useState<Result>(null);
  const [avatar, setAvatar] = useState(avatarUrl);
  const [avatarR, setAvatarR] = useState<Result>(null);
  const [newEmail, setNewEmail] = useState("");
  const [emailR, setEmailR] = useState<Result>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwR, setPwR] = useState<Result>(null);
  const [outR, setOutR] = useState<Result>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy("name");
    const { error } = await supabase.auth.updateUser({ data: { full_name: fullName.trim().slice(0, 80) } });
    setBusy(null);
    setNameR(error ? { ok: false, text: error.message } : { ok: true, text: "Name saved." });
    if (!error) router.refresh();
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("avatar");
    setAvatarR(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("purpose", "avatar");
      const res = await fetch("/api/upload", { method: "POST", body });
      const out = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!res.ok || !out.url) return setAvatarR({ ok: false, text: out.message ?? "Upload failed." });
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: out.url } });
      if (error) return setAvatarR({ ok: false, text: error.message });
      setAvatar(out.url);
      setAvatarR({ ok: true, text: "Profile picture saved." });
      router.refresh();
    } catch {
      setAvatarR({ ok: false, text: "Upload failed. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function removeAvatar() {
    setBusy("avatar");
    const { error } = await supabase.auth.updateUser({ data: { avatar_url: "" } });
    setBusy(null);
    if (error) return setAvatarR({ ok: false, text: error.message });
    setAvatar("");
    setAvatarR({ ok: true, text: "Profile picture removed." });
    router.refresh();
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    const target = newEmail.trim();
    if (!target || target.toLowerCase() === email.toLowerCase()) return setEmailR({ ok: false, text: "Enter a different email address." });
    setBusy("email");
    const { error } = await supabase.auth.updateUser({ email: target }, { emailRedirectTo: `${location.origin}/auth/callback?next=/settings` });
    setBusy(null);
    setEmailR(error ? { ok: false, text: error.message } : { ok: true, text: "Check your inbox. Open the confirmation link to finish changing your email." });
    if (!error) setNewEmail("");
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setPwR({ ok: false, text: "Use a password of at least 8 characters." });
    if (next !== confirm) return setPwR({ ok: false, text: "The new passwords do not match." });
    if (next === current) return setPwR({ ok: false, text: "Choose a password different from the current one." });
    setBusy("password");
    setPwR(null);
    // Supabase does not ask for the current password itself, so check it here before changing anything.
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      setBusy(null);
      return setPwR({ ok: false, text: "Your current password is incorrect." });
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(null);
    if (error) return setPwR({ ok: false, text: error.message });
    setCurrent(""); setNext(""); setConfirm("");
    setPwR({ ok: true, text: "Password changed." });
  }

  async function signOutEverywhere() {
    setBusy("signout");
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      setBusy(null);
      return setOutR({ ok: false, text: error.message });
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <Section title="Profile">
        <div className="flex items-center gap-4">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="Your profile picture" className="size-20 rounded-full border border-line object-cover" />
          ) : (
            <span aria-hidden="true" className="flex size-20 items-center justify-center rounded-full bg-accent-soft text-2xl font-semibold text-accent">
              {(fullName || email).trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <label className={`btn cursor-pointer ${busy === "avatar" ? "pointer-events-none opacity-60" : ""}`}>
                {busy === "avatar" ? "Uploading…" : avatar ? "Change picture" : "Upload picture"}
                <input type="file" accept="image/png,image/jpeg,image/gif" className="sr-only" onChange={uploadAvatar} disabled={busy === "avatar"} />
              </label>
              {avatar && <button type="button" className="btn" onClick={removeAvatar} disabled={busy === "avatar"}>Remove</button>}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG or GIF, up to 5 MB.</p>
          </div>
        </div>
        <Status r={avatarR} />
        <form onSubmit={saveName} className="grid gap-3">
          <label htmlFor="full-name" className="text-sm font-medium">Name</label>
          <input id="full-name" className="field" maxLength={80} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <Status r={nameR} />
          <button type="submit" className="btn btn-primary justify-self-start" disabled={busy === "name"}>{busy === "name" ? "Saving…" : "Save name"}</button>
        </form>
      </Section>

      <Section title="Email" hint={`You sign in with ${email}. A confirmation link is sent to the new address before it changes.`}>
        <form onSubmit={saveEmail} className="grid gap-3">
          <label htmlFor="new-email" className="text-sm font-medium">New email</label>
          <input id="new-email" type="email" required autoComplete="email" className="field" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          <Status r={emailR} />
          <button type="submit" className="btn btn-primary justify-self-start" disabled={busy === "email"}>{busy === "email" ? "Sending…" : "Change email"}</button>
        </form>
      </Section>

      {hasPassword && (
        <Section title="Password">
          <form onSubmit={savePassword} className="grid gap-3">
            <label htmlFor="current-password" className="text-sm font-medium">Current password</label>
            <PasswordInput id="current-password" required autoComplete="current-password" className="field" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <label htmlFor="next-password" className="text-sm font-medium">New password</label>
            <PasswordInput id="next-password" required minLength={8} autoComplete="new-password" className="field" value={next} onChange={(e) => setNext(e.target.value)} />
            <label htmlFor="confirm-password" className="text-sm font-medium">Confirm new password</label>
            <PasswordInput id="confirm-password" required minLength={8} autoComplete="new-password" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <Status r={pwR} />
            <button type="submit" className="btn btn-primary justify-self-start" disabled={busy === "password"}>{busy === "password" ? "Changing…" : "Change password"}</button>
          </form>
        </Section>
      )}

      <Section title="Sessions" hint="Signs you out on every device, including this one. Use it if you lost a device or think someone else has your password.">
        <Status r={outR} />
        <button type="button" className="btn justify-self-start" onClick={signOutEverywhere} disabled={busy === "signout"}>{busy === "signout" ? "Signing out…" : "Sign out everywhere"}</button>
      </Section>
    </>
  );
}
