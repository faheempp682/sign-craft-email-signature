"use client";

import { useCallback, useState } from "react";

export type CallResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number };

/** One fetch to our own API with a JSON body; the server's own message is returned on failure. */
export async function call<T = unknown>(method: string, url: string, body?: unknown): Promise<CallResult<T>> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!res.ok) return { ok: false, status: res.status, message: data?.message ?? "That did not work. Please try again." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server. Check your connection and try again." };
  }
}

/** Tracks the key of the change in flight plus the last error / notice, announced to screen readers by <Status/>. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const run = useCallback(async <T,>(key: string, fn: () => Promise<CallResult<T>>, done = ""): Promise<CallResult<T>> => {
    setBusy(key);
    setError("");
    setNotice("");
    const r = await fn();
    if (r.ok) setNotice(done);
    else setError(r.message);
    setBusy(null);
    return r;
  }, []);
  return { busy, error, notice, run, setError, setNotice };
}

export function Status({ error, notice }: { error: string; notice: string }) {
  return (
    <div aria-live="polite" className="min-h-6 text-sm">
      {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : notice ? <p className="text-muted">{notice}</p> : null}
    </div>
  );
}

export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-muted">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

/** Fixed locale and zone so the server-rendered and browser-rendered text match (no hydration mismatch). */
export const formatDate = (iso: string) => `${new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
