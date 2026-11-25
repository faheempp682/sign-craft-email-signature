"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed, safeNext, signUpError } from "@/lib/supabase/auth-utils";

export type AuthState = { error?: string; message?: string };

const NOT_CONFIGURED: AuthState = {
  error: "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart the dev server.",
};

function credentials(form: FormData) {
  return { email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? "") };
}

/**
 * The login form's one action. Which of the two it does is read from the submitted form (hidden field "mode"), not from which
 * function React was handed: swapping the action of useActionState when the person toggles between the modes could leave a
 * later "Sign in" click running sign-up.
 */
export async function authenticate(prev: AuthState, form: FormData): Promise<AuthState> {
  return form.get("mode") === "up" ? signUp(prev, form) : signIn(prev, form);
}

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;
  const { email, password } = credentials(form);
  if (!email || !password) return { error: "Enter your email and password." };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase uses one generic message for wrong email/password, which avoids leaking which accounts exist.
    return { error: error.message === "Email not confirmed" ? "Confirm your email first. Check your inbox for the link." : "Incorrect email or password." };
  }
  redirect(safeNext(form.get("next")));
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;
  const { email, password } = credentials(form);
  if (!email || !password) return { error: "Enter an email and a password." };
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };
  if (!isEmailAllowed(email)) return { error: "Sign-ups are limited to approved company email domains." };
  // The invitation itself is enforced by the database (it cannot be skipped by calling Supabase directly); see 0017_invite_only.sql.

  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext(form.get("next")))}` },
  });
  if (error) return { error: signUpError(error.message) };

  // With email confirmation on, there is no session yet; with it off, the user is already signed in.
  if (data.session) redirect(safeNext(form.get("next")));
  return { message: "Account created. Check your email for a confirmation link, then sign in." };
}

/** "Forgot password?": emails a reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
  if (error && error.status === 429) return { error: "Too many requests. Wait a few minutes and try again." };
  return { message: "If that email has an account, a reset link is on its way." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase?.auth.signOut();
  redirect("/login");
}
