"use client";

import { useActionState, useState } from "react";
import { PasswordInput } from "@/components/password-input";
import { authenticate, requestPasswordReset, type AuthState } from "./actions";

const FIELD = "min-h-12 w-full rounded-xl border border-transparent bg-surface-2/60 px-4 text-sm outline-none transition-colors placeholder:text-muted focus:border-[#1d3fd1] focus:bg-surface";
const PRIMARY = "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#1d3fd1] text-base font-semibold text-white transition hover:brightness-110 disabled:opacity-60";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [state, action, pending] = useActionState<AuthState, FormData>(authenticate, {});
  const [resetState, resetAction, resetPending] = useActionState<AuthState, FormData>(requestPasswordReset, {});

  if (mode === "forgot") {
    return (
      <form action={resetAction} className="space-y-5">
        <p className="text-sm text-muted">Enter your email and we will send you a link to set a new password.</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reset-email" className="text-sm font-semibold">Email</label>
          <input id="reset-email" name="email" type="email" autoComplete="email" required className={FIELD} />
        </div>
        <div role="status" aria-live="polite">
          {resetState.error && <p className="text-sm text-red-600 dark:text-red-400">{resetState.error}</p>}
          {resetState.message && <p className="text-sm text-[#1d3fd1] dark:text-[#8cc8ff]">{resetState.message}</p>}
        </div>
        <button type="submit" className={PRIMARY} disabled={resetPending}>{resetPending ? "Please wait…" : "Send reset link"}</button>
        <button type="button" className="min-h-11 w-full text-sm font-semibold text-[#1d3fd1] dark:text-[#8cc8ff]" onClick={() => setMode("in")}>Back to sign in</button>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="mode" value={mode} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-semibold">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className={FIELD} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-semibold">Password</label>
        <PasswordInput id="password" name="password" autoComplete={mode === "in" ? "current-password" : "new-password"} minLength={mode === "up" ? 8 : undefined} required className={FIELD} />
        {mode === "up" && <p className="text-xs text-muted">At least 8 characters. Use the email address your invitation was sent to.</p>}
      </div>

      {mode === "in" && (
        <button type="button" className="-mt-2 text-sm font-semibold text-[#1d3fd1] dark:text-[#8cc8ff]" onClick={() => setMode("forgot")}>Forgot password?</button>
      )}

      <div role="status" aria-live="polite">
        {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        {state.message && <p className="text-sm text-[#1d3fd1] dark:text-[#8cc8ff]">{state.message}</p>}
      </div>

      <button type="submit" className={PRIMARY} disabled={pending}>
        {pending ? "Please wait…" : mode === "in" ? "Sign in" : "Create my account"}
      </button>
      <button type="button" className="min-h-11 w-full text-sm font-semibold text-[#1d3fd1] dark:text-[#8cc8ff]" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? "Invited? Create your account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
