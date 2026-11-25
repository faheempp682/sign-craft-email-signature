"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/components/password-input";
import { createBrowserClient } from "@supabase/ssr";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    // The client turns the token in the link into a session shortly after load.
    const { data } = supabase.auth.onAuthStateChange((_e, session) => { if (session) setReady(true); });
    supabase.auth.getSession().then(({ data: { session } }) => setReady((r) => (session ? true : r)));
    const t = setTimeout(() => setReady((r) => r ?? false), 3000);
    return () => { data.subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Use a password of at least 8 characters.");
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    router.replace("/create");
    router.refresh();
  }

  if (ready === false) return <p role="alert" className="text-sm">This link is invalid or has expired. Request a new reset link from the <a className="underline" href="/login">sign-in page</a> (Forgot password?), or ask for a new invitation.</p>;
  return (
    <form onSubmit={submit} className="grid gap-3">
      <label htmlFor="new-password" className="text-sm font-medium">New password</label>
      <PasswordInput id="new-password" required minLength={8} autoComplete="new-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
    </form>
  );
}
