"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Status, useSave } from "../use-save";

export type VariantRow = { id?: string; label: string; imageUrl: string; altText: string; width: number; height: number; weight: number };
export type CampaignRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "ended" | string;
  startsAt: string | null;
  endsAt: string | null;
  href: string;
  fallbackSrc: string;
  fallbackAlt: string;
  variants: VariantRow[];
};

const isHttps = (v: string) => /^https:\/\/[^\s/$.?#][^\s]*$/i.test(v.trim());
/** <input type="datetime-local"> wants local time without a zone. */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export function phase(c: Pick<CampaignRow, "status" | "startsAt" | "endsAt">, now = Date.now()): { label: string; tone: "on" | "off" } {
  if (c.status === "draft") return { label: "Draft", tone: "off" };
  if (c.status === "paused") return { label: "Paused", tone: "off" };
  if (c.status === "ended") return { label: "Ended", tone: "off" };
  if (c.startsAt && Date.parse(c.startsAt) > now) return { label: "Scheduled", tone: "off" };
  if (c.endsAt && Date.parse(c.endsAt) <= now) return { label: "Finished", tone: "off" };
  return { label: "Running now", tone: "on" };
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-muted">{label}</label>
      {children}
      {error && <p id={`${id}-err`} className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function CampaignsAdmin({ campaigns, trackingReady }: { campaigns: CampaignRow[]; trackingReady: boolean }) {
  const { busy, error, notice, save } = useSave();
  return (
    <div className="space-y-10">
      <Status error={error} notice={notice} />
      <p className="max-w-2xl text-sm text-muted">
        A campaign swaps the banner in your signatures on a schedule, and can split the audience between versions (A/B). Clicks are the number to trust; image loads include mail apps that fetch images in advance.
      </p>
      {!trackingReady && (
        <p role="alert" className="card border-l-4 p-4 text-sm">
          Tracked links are switched off because <code>CAMPAIGN_TOKEN_SECRET</code> is not set on the server (32 characters or more). Campaigns can be prepared, but no signature will use them until it is set.
        </p>
      )}
      <NewCampaign />
      <section aria-labelledby="list-h" className="space-y-6">
        <h2 id="list-h" className="text-lg font-semibold">Your campaigns</h2>
        {campaigns.length === 0 && <p className="text-sm text-muted">No campaigns yet. Create the first one above.</p>}
        {campaigns.map((c) => (
          <CampaignCard key={c.id} c={c} busy={busy} save={save} />
        ))}
      </section>
    </div>
  );
}

type SaveFn = ReturnType<typeof useSave>["save"];

function NewCampaign() {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [f, setF] = useState({ name: "", href: "", fallback: "", alt: "", starts: "", ends: "", active: false });
  const [errs, setErrs] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!f.name.trim()) next.name = "Give the campaign a name.";
    if (!isHttps(f.href)) next.href = "Enter a full https:// link.";
    if (!isHttps(f.fallback)) next.fallback = "Enter the full https:// address of the usual banner image.";
    if (f.starts && f.ends && new Date(f.ends) <= new Date(f.starts)) next.ends = "The end must be after the start.";
    setErrs(next);
    if (Object.keys(next).length) return;
    setSending(true);
    setFormError("");
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: f.name.trim(), href: f.href.trim(), fallback_src: f.fallback.trim(), fallback_alt: f.alt.trim(), starts_at: toIso(f.starts), ends_at: toIso(f.ends), status: f.active ? "active" : "draft" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setFormError(data?.message ?? "That did not work. Please try again.");
        return;
      }
      setF({ name: "", href: "", fallback: "", alt: "", starts: "", ends: "", active: false });
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <form onSubmit={submit} className="card space-y-4 p-4 sm:p-6" aria-labelledby="new-h" noValidate>
      <h2 id="new-h" className="text-lg font-semibold">New campaign</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="n-name" label="Name" error={errs.name}><input id="n-name" className="field min-h-11 w-full" value={f.name} onChange={set("name")} maxLength={120} aria-invalid={!!errs.name} aria-describedby={errs.name ? "n-name-err" : undefined} /></Field>
        <Field id="n-href" label="Where a click goes" error={errs.href}><input id="n-href" className="field min-h-11 w-full" inputMode="url" placeholder="https://" value={f.href} onChange={set("href")} aria-invalid={!!errs.href} aria-describedby={errs.href ? "n-href-err" : undefined} /></Field>
        <Field id="n-fb" label="Usual banner image (shown when no campaign runs)" error={errs.fallback}><input id="n-fb" className="field min-h-11 w-full" inputMode="url" placeholder="https://" value={f.fallback} onChange={set("fallback")} aria-invalid={!!errs.fallback} aria-describedby={errs.fallback ? "n-fb-err" : undefined} /></Field>
        <Field id="n-alt" label="Alt text for the usual banner"><input id="n-alt" className="field min-h-11 w-full" value={f.alt} onChange={set("alt")} maxLength={160} /></Field>
        <Field id="n-start" label="Starts (optional)"><input id="n-start" type="datetime-local" className="field min-h-11 w-full" value={f.starts} onChange={set("starts")} /></Field>
        <Field id="n-end" label="Ends (optional)" error={errs.ends}><input id="n-end" type="datetime-local" className="field min-h-11 w-full" value={f.ends} onChange={set("ends")} aria-invalid={!!errs.ends} aria-describedby={errs.ends ? "n-end-err" : undefined} /></Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={f.active} onChange={set("active")} /> Switch it on straight away (otherwise it stays a draft)</label>
      {formError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
      <button type="submit" className="btn btn-primary min-h-11" disabled={sending}>{sending ? "Creating…" : "Create campaign"}</button>
    </form>
  );
}

function CampaignCard({ c, busy, save }: { c: CampaignRow; busy: string | null; save: SaveFn }) {
  const ph = phase(c);
  const [confirm, setConfirm] = useState(false);
  const [edit, setEdit] = useState({ name: c.name, href: c.href, starts: toLocal(c.startsAt), ends: toLocal(c.endsAt) });
  const [editErr, setEditErr] = useState<Record<string, string>>({});
  const dirty = edit.name !== c.name || edit.href !== c.href || edit.starts !== toLocal(c.startsAt) || edit.ends !== toLocal(c.endsAt);

  const setStatus = (status: string, msg: string) => save(`s-${c.id}`, "PATCH", `/api/campaigns/${c.id}`, { status }, msg);

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!edit.name.trim()) next.name = "Give the campaign a name.";
    if (!isHttps(edit.href)) next.href = "Enter a full https:// link.";
    if (edit.starts && edit.ends && new Date(edit.ends) <= new Date(edit.starts)) next.ends = "The end must be after the start.";
    setEditErr(next);
    if (Object.keys(next).length) return;
    await save(`d-${c.id}`, "PATCH", `/api/campaigns/${c.id}`, { name: edit.name.trim(), href: edit.href.trim(), starts_at: toIso(edit.starts), ends_at: toIso(edit.ends) }, `${edit.name.trim()} saved.`);
  }

  return (
    <article className="card divide-y divide-line" aria-labelledby={`c-${c.id}`}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <h3 id={`c-${c.id}`} className="min-w-0 flex-1 truncate font-semibold">{c.name}</h3>
        <span className={cn("rounded-full px-3 py-1 text-xs font-medium", ph.tone === "on" ? "bg-accent text-accent-ink" : "bg-accent-soft text-ink")}>{ph.label}</span>
        {(c.status === "draft" || c.status === "paused" || c.status === "ended") && (
          <button type="button" className="btn btn-primary min-h-11" disabled={busy === `s-${c.id}`} onClick={() => void setStatus("active", `${c.name} is switched on.`)}>{c.status === "paused" ? "Resume" : "Switch on"}</button>
        )}
        {c.status === "active" && (
          <>
            <button type="button" className="btn min-h-11" disabled={busy === `s-${c.id}`} onClick={() => void setStatus("paused", `${c.name} is paused. Signatures show the usual banner.`)}>Pause</button>
            <button type="button" className="btn min-h-11" disabled={busy === `s-${c.id}`} onClick={() => void setStatus("ended", `${c.name} has ended.`)}>End</button>
          </>
        )}
      </header>

      <form onSubmit={saveDetails} className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-6" noValidate aria-label={`${c.name}: details`}>
        <Field id={`e-name-${c.id}`} label="Name" error={editErr.name}><input id={`e-name-${c.id}`} className="field min-h-11 w-full" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={120} /></Field>
        <Field id={`e-href-${c.id}`} label="Where a click goes" error={editErr.href}><input id={`e-href-${c.id}`} className="field min-h-11 w-full" value={edit.href} onChange={(e) => setEdit({ ...edit, href: e.target.value })} /></Field>
        <Field id={`e-start-${c.id}`} label="Starts"><input id={`e-start-${c.id}`} type="datetime-local" className="field min-h-11 w-full" value={edit.starts} onChange={(e) => setEdit({ ...edit, starts: e.target.value })} /></Field>
        <Field id={`e-end-${c.id}`} label="Ends" error={editErr.ends}><input id={`e-end-${c.id}`} type="datetime-local" className="field min-h-11 w-full" value={edit.ends} onChange={(e) => setEdit({ ...edit, ends: e.target.value })} /></Field>
        <div className="sm:col-span-2"><button type="submit" className="btn min-h-11" disabled={!dirty || busy === `d-${c.id}`}>{busy === `d-${c.id}` ? "Saving…" : "Save details"}</button></div>
      </form>

      {/* Re-mount when the saved variants change, so rows added here pick up the ids the server gave them. */}
      <Variants key={c.variants.map((v) => `${v.id}:${v.weight}:${v.imageUrl}`).join("|")} c={c} busy={busy} save={save} />
      <Tools c={c} />

      <footer className="px-4 py-3 sm:px-6">
        {confirm ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>Delete {c.name} and its statistics for good?</span>
            <button type="button" className="btn min-h-11" onClick={() => void save(`x-${c.id}`, "DELETE", `/api/campaigns/${c.id}`, {}, `${c.name} deleted.`)} disabled={busy === `x-${c.id}`}>Yes, delete</button>
            <button type="button" className="btn min-h-11" onClick={() => setConfirm(false)}>Keep it</button>
          </div>
        ) : (
          <button type="button" className="btn min-h-11" onClick={() => setConfirm(true)}>Delete campaign</button>
        )}
      </footer>
    </article>
  );
}

function Variants({ c, busy, save }: { c: CampaignRow; busy: string | null; save: SaveFn }) {
  const [rows, setRows] = useState<VariantRow[]>(c.variants);
  const [errs, setErrs] = useState<Record<number, string>>({});
  const total = rows.reduce((n, r) => n + (Number.isFinite(r.weight) ? r.weight : 0), 0);
  const patch = (i: number, p: Partial<VariantRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<number, string> = {};
    rows.forEach((r, i) => {
      if (!isHttps(r.imageUrl)) next[i] = "Enter the full https:// address of the image.";
      else if (!Number.isInteger(r.weight) || r.weight < 0 || r.weight > 1000) next[i] = "Weight must be a whole number from 0 to 1000.";
    });
    if (rows.length && total <= 0 && !Object.keys(next).length) next[0] = "At least one variant needs a weight above 0.";
    setErrs(next);
    if (Object.keys(next).length) return;
    await save(`v-${c.id}`, "PUT", `/api/campaigns/${c.id}/variants`, { variants: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), label: r.label, image_url: r.imageUrl.trim(), alt_text: r.altText, width: r.width, height: r.height, weight: r.weight })) }, `Variants for ${c.name} saved.`);
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-4 py-4 sm:px-6" noValidate aria-label={`${c.name}: banner variants`}>
      <div>
        <h4 className="font-medium">Banner variants</h4>
        <p className="text-sm text-muted">One image shows each signature. Give two or more variants to split the audience; a bigger weight means more people see it. Without variants, the usual banner is shown.</p>
      </div>
      {rows.map((r, i) => {
        const id = `${c.id}-${i}`;
        const share = total > 0 ? Math.round((r.weight / total) * 100) : 0;
        return (
          <fieldset key={r.id ?? `new-${i}`} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_2fr_6rem]">
            <legend className="px-1 text-sm font-medium">Variant {String.fromCharCode(65 + i)} <span className="font-normal text-muted">({share}% of signatures)</span></legend>
            <Field id={`vl-${id}`} label="Label"><input id={`vl-${id}`} className="field min-h-11 w-full" value={r.label} onChange={(e) => patch(i, { label: e.target.value })} maxLength={60} /></Field>
            <Field id={`vu-${id}`} label="Image address" error={errs[i]}><input id={`vu-${id}`} className="field min-h-11 w-full" inputMode="url" placeholder="https://" value={r.imageUrl} onChange={(e) => patch(i, { imageUrl: e.target.value })} aria-invalid={!!errs[i]} aria-describedby={errs[i] ? `vu-${id}-err` : undefined} /></Field>
            <Field id={`vw-${id}`} label="Weight"><input id={`vw-${id}`} className="field min-h-11 w-full" inputMode="numeric" value={Number.isFinite(r.weight) ? String(r.weight) : ""} onChange={(e) => patch(i, { weight: e.target.value === "" ? NaN : Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2"><Field id={`va-${id}`} label="Alt text"><input id={`va-${id}`} className="field min-h-11 w-full" value={r.altText} onChange={(e) => patch(i, { altText: e.target.value })} maxLength={160} /></Field></div>
            <div className="flex items-end"><button type="button" className="btn min-h-11 w-full" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove variant ${String.fromCharCode(65 + i)}`}>Remove</button></div>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn min-h-11" disabled={rows.length >= 8} onClick={() => setRows([...rows, { label: "", imageUrl: "", altText: "", width: 400, height: 100, weight: 1 }])}>Add a variant</button>
        <button type="submit" className="btn btn-primary min-h-11" disabled={busy === `v-${c.id}`}>{busy === `v-${c.id}` ? "Saving…" : "Save variants"}</button>
      </div>
    </form>
  );
}

type Link = { click_url: string; image_url: string; warning: string | null };

function Tools({ c }: { c: CampaignRow }) {
  const [sig, setSig] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<null | { running: boolean; variant: null | { label: string; image_url: string }; fallback_src: string }>(null);
  const [links, setLinks] = useState<Link | null>(null);
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sig.trim());

  async function call(path: string, body: unknown) {
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/campaigns/${c.id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr((data as { message?: string } | null)?.message ?? "That did not work. Please try again.");
        return null;
      }
      return data;
    } catch {
      setErr("Could not reach the server. Check your connection and try again.");
      return null;
    }
  }

  async function check() {
    if (!validId) return setErr("Enter a signature id (a uuid), or press Use a random one.");
    const d = await call("preview", { signature_id: sig.trim() });
    if (d) setPreview(d);
  }

  async function copy() {
    const d = (await call("link", sig.trim() && validId ? { signature_id: sig.trim() } : {})) as Link | null;
    if (!d) return;
    setLinks(d);
    try {
      await navigator.clipboard.writeText(d.click_url);
      setMsg("Tracked link copied.");
    } catch {
      setMsg("Select the link below and copy it.");
    }
  }

  return (
    <section className="space-y-4 px-4 py-4 sm:px-6" aria-label={`${c.name}: preview and link`}>
      <h4 className="font-medium">Preview and tracked link</h4>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`sig-${c.id}`} className="mb-1 block text-sm text-muted">Signature id</label>
          <input id={`sig-${c.id}`} className="field min-h-11 w-full" value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Which signature should we check?" spellCheck={false} />
        </div>
        <button type="button" className="btn min-h-11" onClick={() => setSig(crypto.randomUUID())}>Use a random one</button>
        <button type="button" className="btn min-h-11" onClick={() => void check()}>Which variant?</button>
        <button type="button" className="btn min-h-11" onClick={() => void copy()}>Copy tracked link</button>
      </div>
      <div aria-live="polite" className="min-h-6 text-sm">
        {err ? <p className="text-red-600 dark:text-red-400">{err}</p> : msg ? <p className="text-muted">{msg}</p> : null}
        {preview && !err && (
          <p>
            {!preview.running ? "This campaign is not running now, so that signature shows the usual banner." : preview.variant ? <>That signature always sees <strong>{preview.variant.label || "this variant"}</strong>.</> : "No variant has a weight above 0, so the usual banner shows."}
          </p>
        )}
      </div>
      {links && (
        <div className="space-y-2 text-sm">
          {links.warning && <p role="alert" className="text-red-600 dark:text-red-400">{links.warning}</p>}
          <label htmlFor={`cl-${c.id}`} className="block text-muted">Click link</label>
          <input id={`cl-${c.id}`} readOnly className="field min-h-11 w-full" value={links.click_url} onFocus={(e) => e.currentTarget.select()} />
          <label htmlFor={`il-${c.id}`} className="block text-muted">Image link</label>
          <input id={`il-${c.id}`} readOnly className="field min-h-11 w-full" value={links.image_url} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </section>
  );
}
