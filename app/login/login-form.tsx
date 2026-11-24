"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "in" ? signIn : signUp, {});

  return (
    <form action={action} className="card space-y-4 p-6">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} minLength={mode === "up" ? 8 : undefined} required className="field" />
        {mode === "up" && <p className="text-xs text-muted">At least 8 characters.</p>}
      </div>

      <div role="status" aria-live="polite">
        {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        {state.message && <p className="text-sm text-accent">{state.message}</p>}
      </div>

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
      </button>
      <button type="button" className="min-h-11 w-full text-sm font-medium text-accent" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? "No account yet? Create one" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
