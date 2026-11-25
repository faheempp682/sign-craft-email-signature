"use client";

import { useCallback, useEffect, useState } from "react";
import type { PolishDetail } from "@/lib/polish/route";

export type Outcome = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

/** One JSON write to the polish API. Always resolves; failures carry the server's own message. */
export async function send(url: string, body: unknown = {}): Promise<Outcome> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { ok: false, message: typeof data?.message === "string" ? data.message : "That did not work. Please try again." };
    return { ok: true, data: data ?? {} };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

type Load = { state: "loading" } | { state: "error"; status: number; message: string } | { state: "ready"; detail: PolishDetail };

/** Loads one request and lets the caller reload it after a change. */
export function usePolishRequest(id: string) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/polish/${id}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as (PolishDetail & { message?: string }) | null;
      if (!res.ok || !data) setLoad({ state: "error", status: res.status, message: data?.message ?? "Could not load this request." });
      else setLoad({ state: "ready", detail: data });
    } catch {
      setLoad({ state: "error", status: 0, message: "Could not reach the server. Check your connection and try again." });
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { load, reload };
}
