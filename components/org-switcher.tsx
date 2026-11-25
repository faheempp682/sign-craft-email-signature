"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { ActableOrg } from "@/lib/org/active";

type Props = { initial?: { orgs: ActableOrg[]; active: string | null } };

/**
 * Organization switcher for the top bar. Renders nothing for a person with a single organization (and no agency role).
 * Switching is a same-origin POST that the server validates; the page then refreshes.
 */
export function OrgSwitcher({ initial }: Props) {
  const router = useRouter();
  const id = useId();
  const [orgs, setOrgs] = useState<ActableOrg[]>(initial?.orgs ?? []);
  const [active, setActive] = useState<string | null>(initial?.active ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) return;
    let gone = false;
    fetch("/api/agency/orgs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { active: string | null; orgs: ActableOrg[] } | null) => {
        if (!gone && d) {
          setOrgs(d.orgs);
          setActive(d.active);
        }
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [initial]);

  if (orgs.length <= 1) return null;

  async function pick(next: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agency/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_id: next }) });
      if (!res.ok) {
        setError("Could not switch organization.");
        return;
      }
      setActive(next);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">Organization</label>
      <select id={id} className="field min-h-11 max-w-[14rem] truncate" value={active ?? ""} disabled={busy} onChange={(e) => void pick(e.target.value)}>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>{o.viaAgency ? `Client: ${o.name}` : o.name}</option>
        ))}
      </select>
      <span role="status" className="text-sm text-red-600 dark:text-red-400">{error}</span>
    </div>
  );
}
