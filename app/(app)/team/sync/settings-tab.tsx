"use client";

import { useEffect, useState } from "react";
import { call, Field, Status, useAction } from "../api";
import type { StatusData } from "./sync-types";

export function SettingsTab({ status, onChanged }: { status: StatusData; onChanged: () => void }) {
  const [cap, setCap] = useState(String(status.safety_cap_percent));
  const [note, setNote] = useState("");
  const [capError, setCapError] = useState("");
  const { busy, error, notice, run } = useAction();

  useEffect(() => {
    call<{ safety_cap_percent: number; schedule_note: string }>("GET", "/api/sync/settings").then((r) => {
      if (r.ok) {
        setCap(String(r.data.safety_cap_percent));
        setNote(r.data.schedule_note);
      }
    });
  }, []);

  async function save() {
    setCapError("");
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 1 || n > 100) return setCapError("Enter a whole number from 1 to 100.");
    const r = await run("save", () => call("PUT", "/api/sync/settings", { safety_cap_percent: n, schedule_note: note }), "Saved.");
    if (r.ok) onChanged();
  }

  return (
    <div className="max-w-2xl space-y-8">
      <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="cap-h">
        <h2 id="cap-h" className="text-lg font-semibold">Safety cap</h2>
        <p className="text-sm text-muted">
          A run is refused when it would deactivate more than this share of the people a source manages (or, for a CRM, erase values for more than this share of people). It is also refused when the source returns nothing at all, so a failed request can never wipe the directory. The same rule is checked inside the database when you confirm and for scheduled runs.
        </p>
        <Field id="cap" label="Largest share allowed (percent)" error={capError} hint="Default 20. With 10 managed people and a cap of 20, two can be deactivated in one run.">
          <input id="cap" className="field w-32" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={!!capError} aria-describedby={capError ? "cap-err" : undefined} />
        </Field>
      </section>

      <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="sched-h">
        <h2 id="sched-h" className="text-lg font-semibold">Schedule</h2>
        <p className="text-sm text-muted">
          Scheduled runs come from your own scheduler (a cron job, GitHub Actions, your host&apos;s cron) calling <code>POST /api/sync/run</code> with the header <code>Authorization: Bearer &lt;SYNC_CRON_SECRET&gt;</code>. SignCraft does not schedule itself.
        </p>
        <p className="text-sm" role="status">
          {status.cron_configured ? "SYNC_CRON_SECRET is set on the server: the endpoint is on." : "SYNC_CRON_SECRET is not set on the server (it needs at least 32 characters): the endpoint is off."}
        </p>
        <Field id="note" label="Note for your team" hint="For example “Nightly at 02:00 from the company scheduler”. Only a reminder; it does not schedule anything.">
          <input id="note" className="field w-full" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </section>

      <div className="space-y-2">
        <Status error={error} notice={notice} />
        <button type="button" className="btn btn-primary" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
