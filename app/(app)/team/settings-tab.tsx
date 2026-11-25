"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { call, Status, useAction } from "./api";

export function SettingsTab() {
  const [on, setOn] = useState<boolean | null>(null);
  const { busy, error, notice, run } = useAction();
  useEffect(() => {
    call<{ require_approval: boolean }>("GET", "/api/team/settings").then((r) => r.ok && setOn(r.data.require_approval));
  }, []);

  async function change(next: boolean) {
    const r = await run("approval", () => call<{ require_approval: boolean }>("PUT", "/api/team/settings", { require_approval: next }), next ? "Changes now wait for approval." : "Changes now apply immediately.");
    if (r.ok) setOn(next);
  }

  return (
    <section className="card max-w-2xl space-y-4 p-4 sm:p-6" aria-labelledby="set-h">
      <h2 id="set-h" className="text-lg font-semibold">Approval</h2>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id="appr-label" className="font-medium">Require approval for employee changes</p>
          <p id="appr-desc" className="mt-1 text-sm text-muted">
            Off: when an employee changes an allowed field, it applies at once. On: the change waits in the Approvals tab, and the employee keeps their last approved signature until an admin approves. Admins&apos; own changes are always approved at once.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!on}
          aria-labelledby="appr-label"
          aria-describedby="appr-desc"
          disabled={on === null || busy === "approval"}
          onClick={() => change(!on)}
          className="grid min-h-11 min-w-11 shrink-0 cursor-pointer place-items-center disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-150", on ? "bg-accent" : "bg-line")}>
            <span className={cn("inline-block size-5 rounded-full bg-card shadow transition-transform duration-150", on ? "translate-x-[22px]" : "translate-x-0.5")} />
          </span>
        </button>
      </div>
      <Status error={error} notice={notice} />
    </section>
  );
}
