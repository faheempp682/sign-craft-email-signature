"use client";

import { useState } from "react";
import { call, Field, Status, useAction } from "../api";
import type { HealthStatus } from "./types";

export function SettingsSection({ status, onSaved }: { status: HealthStatus; onSaved: () => void }) {
  const s = status.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  const [names, setNames] = useState(s.include_names);
  const [cap, setCap] = useState(String(s.max_people));
  const [url, setUrl] = useState("");
  const [removeUrl, setRemoveUrl] = useState(false);
  const [capError, setCapError] = useState("");
  const [urlError, setUrlError] = useState("");
  const { busy, error, notice, run } = useAction();

  async function save() {
    setCapError("");
    setUrlError("");
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return setCapError("Enter a whole number from 1 to 1000.");
    const typed = url.trim();
    if (typed && !/^https:\/\/[^\s]+$/.test(typed)) return setUrlError("Enter a full address starting with https://");
    const body: Record<string, unknown> = { enabled, include_names: names, max_people: n };
    if (removeUrl) body.webhook_url = null;
    else if (typed) body.webhook_url = typed;
    const r = await run("save", () => call("PUT", "/api/health/settings", body), "Saved.");
    if (r.ok) {
      setUrl("");
      setRemoveUrl(false);
      onSaved();
    }
  }

  return (
    <section aria-labelledby="set-h" className="card max-w-2xl space-y-6 p-4 sm:p-6">
      <h2 id="set-h" className="text-lg font-semibold">Settings</h2>

      <div className="space-y-2">
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 shrink-0" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Check automatically (needs a scheduler)</span>
        </label>
        <p className="text-sm text-muted">
          SignCraft does not schedule itself. Point your scheduler (cron, GitHub Actions, your host&apos;s cron) at <code>POST /api/health/run</code> with the header <code>Authorization: Bearer &lt;HEALTH_CRON_SECRET&gt;</code>. The secret is a server setting of at least 32 characters; without it the endpoint is off.{" "}
          {status.setup.unattended_ready ? "The server has what it needs." : `Missing on the server: ${status.setup.unattended_missing.concat(status.setup.missing).join(", ")}.`}
        </p>
      </div>

      <div className="space-y-2">
        <Field id="h-url" label="Alert webhook (Slack-compatible, optional)" error={urlError} hint="There is no email service. New findings can be posted to a Slack-style webhook as one message per check. It holds counts and a link back to this screen only, unless you tick the box below.">
          <input id="h-url" className="field w-full" type="url" inputMode="url" autoComplete="off" placeholder={s.has_webhook ? `Saved: ${s.webhook_masked ?? "https://…"} (type a new address to replace it)` : "https://hooks.slack.com/services/…"} value={url} onChange={(e) => setUrl(e.target.value)} disabled={removeUrl} aria-invalid={!!urlError} aria-describedby={urlError ? "h-url-err" : undefined} />
        </Field>
        {s.has_webhook && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 shrink-0" checked={removeUrl} onChange={(e) => setRemoveUrl(e.target.checked)} />
            <span>Remove the saved webhook</span>
          </label>
        )}
        <label className="flex min-h-11 cursor-pointer items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 shrink-0" checked={names} onChange={(e) => setNames(e.target.checked)} />
          <span>Include people&apos;s names in the alert (otherwise only counts)</span>
        </label>
        <p className="text-sm text-muted">The address must be https and public. Internal addresses are refused. A webhook that fails never stops a check.</p>
      </div>

      <Field id="h-cap" label="Most people per check" error={capError} hint="Between 1 and 1000 (1000 is the hard limit). If more people are monitored, each check continues where the last one stopped.">
        <input id="h-cap" className="field w-32" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={!!capError} aria-describedby={capError ? "h-cap-err" : undefined} />
      </Field>

      <div className="space-y-2">
        <Status error={error} notice={notice} />
        <button type="button" className="btn btn-primary min-h-11" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save settings"}</button>
      </div>
    </section>
  );
}
