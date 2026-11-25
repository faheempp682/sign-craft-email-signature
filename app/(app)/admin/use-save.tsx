"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Sends one admin change to the API and refreshes the server-rendered page when it works.
 * `busy` is the key of the change in flight, so only that row is disabled; `error` is the server's own message.
 */
export function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save(key: string, method: "PUT" | "PATCH" | "DELETE", url: string, body: unknown, done = ""): Promise<boolean> {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message ?? "That did not work. Please try again.");
        return false;
      }
      setNotice(done);
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, notice, save };
}

/** Announces the outcome of a change to screen readers as well as showing it. */
export function Status({ error, notice }: { error: string; notice: string }) {
  return (
    <div aria-live="polite" className="min-h-6 text-sm">
      {error ? <p className="text-red-600 dark:text-red-400">{error}</p> : notice ? <p className="text-muted">{notice}</p> : null}
    </div>
  );
}

/** On/off switch with a 44px touch target. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="grid min-h-11 min-w-11 cursor-pointer place-items-center disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-150", checked ? "bg-accent" : "bg-line")}>
        <span className={cn("inline-block size-5 rounded-full bg-card shadow transition-transform duration-150", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

export const ROLE_LABEL = { member: "Members", designer: "Designers and admins", admin: "Admins only" } as const;
export const ROLE_NAME = { member: "Member", designer: "Designer", admin: "Admin" } as const;
