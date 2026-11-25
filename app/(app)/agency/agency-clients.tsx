"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type Client = { id: string; name: string; planId: string | null; members: number; people: number };
const PLANS = [
  ["", "No plan (no restrictions)"],
  ["free", "Free"],
  ["pro", "Pro"],
  ["business", "Business"],
  ["agency", "Agency"],
] as const;

async function post(url: string, body: unknown): Promise<string> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return "";
    return ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? "That did not work. Please try again.";
  } catch {
    return "Could not reach the server. Check your connection and try again.";
  }
}

export function AgencyClients({ clients, activeId, agencyId, activeIsClient }: { clients: Client[]; activeId: string | null; agencyId: string; activeIsClient: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the client a name.");
    setBusy("create");
    setError("");
    const err = await post("/api/agency/clients", { name, plan_id: plan || null });
    setBusy("");
    if (err) return setError(err);
    setNotice(`${name.trim()} created.`);
    setName("");
    router.refresh();
  }

  async function switchTo(id: string, label: string) {
    setBusy(id);
    setError("");
    const err = await post("/api/agency/switch", { org_id: id });
    setBusy("");
    if (err) return setError(err);
    setNotice(id === agencyId ? "Back in your own organization." : `Now working in ${label}.`);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div aria-live="polite" className="min-h-6 text-sm">
        {error ? <p className="text-red-600 dark:text-red-400">{error}</p> : notice ? <p className="text-muted">{notice}</p> : null}
      </div>

      {activeIsClient && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6">
          <p className="text-sm">You are working inside a client organization.</p>
          <button type="button" className="btn min-h-11" disabled={busy === agencyId} onClick={() => void switchTo(agencyId, "your organization")}>Leave client</button>
        </div>
      )}

      <section aria-labelledby="clients-h">
        <h2 id="clients-h" className="text-lg font-semibold">Clients</h2>
        {clients.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No clients yet. Create the first one below.</p>
        ) : (
          <ul className="card mt-3 divide-y divide-line">
            {clients.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {c.name}
                    {activeId === c.id && <span className="ml-2 text-xs font-normal text-muted">(active)</span>}
                  </p>
                  <p className="text-sm text-muted">
                    Plan: {c.planId ?? "none"} · {c.members} {c.members === 1 ? "member" : "members"} · {c.people} {c.people === 1 ? "person" : "people"} in the directory
                  </p>
                </div>
                <button type="button" className="btn min-h-11" disabled={activeId === c.id || busy === c.id} onClick={() => void switchTo(c.id, c.name)} aria-label={`Switch into ${c.name}`}>
                  {activeId === c.id ? "Active" : "Switch into"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-h">
        <h2 id="new-h" className="text-lg font-semibold">New client organization</h2>
        <form onSubmit={create} className="card mt-3 grid gap-4 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:px-6">
          <div>
            <label htmlFor="client-name" className="mb-1 block text-sm text-muted">Name</label>
            <input id="client-name" className="field w-full" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="client-plan" className="mb-1 block text-sm text-muted">Plan</label>
            <select id="client-plan" className="field w-full" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {PLANS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary min-h-11" disabled={busy === "create"}>{busy === "create" ? "Creating…" : "Create client"}</button>
        </form>
      </section>
    </div>
  );
}
