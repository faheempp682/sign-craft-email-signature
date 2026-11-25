"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardView } from "@/app/c/card-view";
import { EMPTY_FORM, formFromCard, parseForm, previewCard, type CardForm, type FormErrors } from "@/lib/cards/form";
import { MAX_SOCIALS, slugProblem, slugify, type OwnedCard } from "@/lib/cards/schema";
import { cardUrl } from "@/lib/cards/signature-link";
import { SOCIAL_NETWORKS } from "@/lib/schema/document";
import { NETWORK_LABEL } from "@/app/c/card-view";
import { Switch } from "../admin/use-save";

type Slug = { state: "idle" | "checking" | "ok" | "bad"; message: string };

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && !error ? <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-err`} className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

export function CardEditor({ card, origin, cardCount, limit }: { card?: OwnedCard; origin: string; cardCount: number; limit: number }) {
  const router = useRouter();
  const [form, setForm] = useState<CardForm>(card ? formFromCard(card) : EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [slug, setSlug] = useState<Slug>({ state: "idle", message: "" });
  const [slugTouched, setSlugTouched] = useState(!!card);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [qrSrc, setQrSrc] = useState<string | null>(null);

  const set = <K extends keyof CardForm>(k: K, v: CardForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const atLimit = !card && cardCount >= limit;
  const address = cardUrl(form.slug, origin) ?? `${origin}/c/your-address`;

  // Suggest an address from the name until the person edits the address themselves.
  useEffect(() => {
    if (!slugTouched) setForm((f) => ({ ...f, slug: slugify(f.display_name) }));
  }, [form.display_name, slugTouched]);

  // Availability check (debounced). Local rules first, then the server.
  const seq = useRef(0);
  useEffect(() => {
    const s = form.slug.trim().toLowerCase();
    if (!s) return setSlug({ state: "idle", message: "" });
    const problem = slugProblem(s);
    if (problem) return setSlug({ state: "bad", message: problem });
    if (card && s === card.slug) return setSlug({ state: "ok", message: "This is your current address." });
    setSlug({ state: "checking", message: "Checking…" });
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cards/slug?slug=${encodeURIComponent(s)}${card ? `&except=${card.id}` : ""}`);
        const data = (await res.json()) as { available?: boolean; problem?: string | null; message?: string };
        if (mine !== seq.current) return;
        if (!res.ok) return setSlug({ state: "bad", message: data.message ?? "Could not check that address." });
        setSlug(data.available ? { state: "ok", message: "Available." } : { state: "bad", message: data.problem ?? "That address is taken." });
      } catch {
        if (mine === seq.current) setSlug({ state: "bad", message: "Could not check that address. Check your connection." });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form.slug, card]);

  // The QR code in the preview is made in the browser from the same address the public page encodes.
  useEffect(() => {
    let live = true;
    QRCode.toString(address, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((svg) => live && setQrSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`))
      .catch(() => live && setQrSrc(null));
    return () => {
      live = false;
    };
  }, [address]);

  const preview = useMemo(() => previewCard(form), [form]);

  async function call(key: string, method: string, url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
      if (!res.ok) setError(typeof data.message === "string" ? data.message : "That did not work. Please try again.");
      return { ok: res.ok, data };
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return { ok: false, data: {} };
    } finally {
      setBusy("");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setError("Fix the highlighted fields, then save again.");
      setNotice("");
      return;
    }
    setErrors({});
    if (slug.state === "bad") {
      setError("Choose a different address first.");
      return;
    }
    const r = card ? await call("save", "PUT", `/api/cards/${card.id}`, parsed.data) : await call("save", "POST", "/api/cards", parsed.data);
    if (!r.ok) return;
    setNotice(card ? "Saved." : "Card created.");
    if (!card) {
      const id = (r.data.card as { id?: string } | undefined)?.id;
      router.replace(id ? `/cards/${id}` : "/cards");
    }
    router.refresh();
  }

  async function togglePublished(next: boolean) {
    if (!card) return set("published", next); // saved with the card on first save
    const r = await call("publish", "PATCH", `/api/cards/${card.id}`, { published: next });
    if (!r.ok) return;
    set("published", next);
    setNotice(next ? "Your card is now public." : "Your card is no longer public.");
    router.refresh();
  }

  async function remove() {
    if (!card) return;
    const r = await call("delete", "DELETE", `/api/cards/${card.id}`);
    if (r.ok) {
      router.push("/cards");
      router.refresh();
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(address);
      setNotice("Link copied.");
      setError("");
    } catch {
      setError("Could not copy automatically. Select the address and copy it.");
    }
  }

  async function downloadQr() {
    const url = await QRCode.toDataURL(address, { width: 1024, margin: 2, errorCorrectionLevel: "M" });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.slug || "card"}-qr.png`;
    a.click();
  }

  const inputClass = "field w-full";
  const aria = (id: string, err?: string, hint?: boolean) => ({ "aria-invalid": err ? true : undefined, "aria-describedby": err ? `${id}-err` : hint ? `${id}-hint` : undefined });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Digital card</p>
          <h1 className="text-2xl font-semibold tracking-tight">{card ? "Edit card" : "New card"}</h1>
        </div>
        <Link href="/cards" className="btn">Back to cards</Link>
      </div>

      {atLimit ? (
        <p role="alert" className="card mb-6 p-4 text-sm">You already have {limit} cards, which is the maximum. Delete one to make room for a new card.</p>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <form onSubmit={save} noValidate className="space-y-6" aria-label="Card details">
          <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="who-h">
            <h2 id="who-h" className="text-lg font-semibold">About you</h2>
            <Field id="c-name" label="Name" error={errors.display_name}>
              <input id="c-name" className={inputClass} required maxLength={100} autoComplete="name" value={form.display_name} onChange={(e) => set("display_name", e.target.value)} {...aria("c-name", errors.display_name)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="c-title" label="Job title" error={errors.title}>
                <input id="c-title" className={inputClass} maxLength={100} autoComplete="organization-title" value={form.title} onChange={(e) => set("title", e.target.value)} {...aria("c-title", errors.title)} />
              </Field>
              <Field id="c-company" label="Company" error={errors.company}>
                <input id="c-company" className={inputClass} maxLength={100} autoComplete="organization" value={form.company} onChange={(e) => set("company", e.target.value)} {...aria("c-company", errors.company)} />
              </Field>
            </div>
            <Field id="c-bio" label="Short bio" hint={`${form.bio.length} of 300 characters`} error={errors.bio}>
              <textarea id="c-bio" className="field min-h-24 w-full py-2" maxLength={300} rows={3} value={form.bio} onChange={(e) => set("bio", e.target.value)} {...aria("c-bio", errors.bio, true)} />
            </Field>
            <Field id="c-photo" label="Photo address" hint="A link starting with https://, for example an image you uploaded in the editor." error={errors.photo_url}>
              <input id="c-photo" type="url" inputMode="url" className={inputClass} placeholder="https://" value={form.photo_url} onChange={(e) => set("photo_url", e.target.value)} {...aria("c-photo", errors.photo_url, true)} />
            </Field>
          </section>

          <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="contact-h">
            <h2 id="contact-h" className="text-lg font-semibold">Contact details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="c-phone" label="Phone" error={errors.phone}>
                <input id="c-phone" type="tel" className={inputClass} autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} {...aria("c-phone", errors.phone)} />
              </Field>
              <Field id="c-email" label="Email" error={errors.email}>
                <input id="c-email" type="email" className={inputClass} autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} {...aria("c-email", errors.email)} />
              </Field>
            </div>
            <Field id="c-site" label="Website" error={errors.website}>
              <input id="c-site" type="url" inputMode="url" className={inputClass} placeholder="https://" value={form.website} onChange={(e) => set("website", e.target.value)} {...aria("c-site", errors.website)} />
            </Field>
            <Field id="c-booking" label="Booking link" hint="Shown as a Book a meeting button. Must start with https://." error={errors.booking_url}>
              <input id="c-booking" type="url" inputMode="url" className={inputClass} placeholder="https://" value={form.booking_url} onChange={(e) => set("booking_url", e.target.value)} {...aria("c-booking", errors.booking_url, true)} />
            </Field>
            <Field id="c-address" label="Address" error={errors.address}>
              <textarea id="c-address" className="field min-h-20 w-full py-2" maxLength={200} rows={2} autoComplete="street-address" value={form.address} onChange={(e) => set("address", e.target.value)} {...aria("c-address", errors.address)} />
            </Field>
          </section>

          <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="social-h">
            <h2 id="social-h" className="text-lg font-semibold">Social links</h2>
            {form.social_links.map((row, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-start">
                <div>
                  <label className="sr-only" htmlFor={`s-net-${i}`}>Network {i + 1}</label>
                  <select id={`s-net-${i}`} className="field w-full" value={row.network} onChange={(e) => set("social_links", form.social_links.map((r, j) => (j === i ? { ...r, network: e.target.value as typeof row.network } : r)))}>
                    {SOCIAL_NETWORKS.map((n) => (
                      <option key={n} value={n}>{NETWORK_LABEL[n]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="sr-only" htmlFor={`s-url-${i}`}>{NETWORK_LABEL[row.network]} address</label>
                  <input id={`s-url-${i}`} type="url" inputMode="url" className={inputClass} placeholder="https://" value={row.url} onChange={(e) => set("social_links", form.social_links.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)))} {...aria(`s-url-${i}`, errors.social_rows?.[i])} />
                  {errors.social_rows?.[i] ? <p id={`s-url-${i}-err`} className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.social_rows[i]}</p> : null}
                </div>
                <button type="button" className="btn" onClick={() => set("social_links", form.social_links.filter((_, j) => j !== i))} aria-label={`Remove ${NETWORK_LABEL[row.network]} link`}>
                  Remove
                </button>
              </div>
            ))}
            {errors.social_links ? <p className="text-sm text-red-600 dark:text-red-400">{errors.social_links}</p> : null}
            <button type="button" className="btn" disabled={form.social_links.length >= MAX_SOCIALS} onClick={() => set("social_links", [...form.social_links, { network: "linkedin", url: "" }])}>
              Add a social link
            </button>
          </section>

          <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="look-h">
            <h2 id="look-h" className="text-lg font-semibold">Address and look</h2>
            <Field id="c-slug" label="Card address" error={slug.state === "bad" ? slug.message : errors.slug}>
              <div className="flex items-center gap-2">
                <span className="hidden shrink-0 text-sm text-muted sm:inline" aria-hidden="true">{origin.replace(/^https?:\/\//, "")}/c/</span>
                <input id="c-slug" className={inputClass} required maxLength={40} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.slug} onChange={(e) => { setSlugTouched(true); set("slug", e.target.value.toLowerCase()); }} aria-invalid={slug.state === "bad" || undefined} aria-describedby="c-slug-status" />
              </div>
              <p id="c-slug-status" aria-live="polite" className="mt-1 min-h-5 text-sm text-muted">
                {slug.state === "ok" ? `${slug.message} ${address}` : slug.state === "checking" ? slug.message : slug.state === "bad" ? "" : "3 to 40 letters, digits or hyphens."}
              </p>
              {card ? <p className="mt-1 text-xs text-muted">Changing the address breaks links and QR codes you already shared.</p> : null}
            </Field>
            <Field id="c-accent" label="Accent colour" error={errors.accent_color}>
              <div className="flex items-center gap-3">
                <input id="c-accent" type="color" className="h-11 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1" value={/^#[0-9a-fA-F]{6}$/.test(form.accent_color) ? form.accent_color : "#111111"} onChange={(e) => set("accent_color", e.target.value)} />
                <label className="sr-only" htmlFor="c-accent-hex">Accent colour as hex</label>
                <input id="c-accent-hex" className="field w-32" value={form.accent_color} maxLength={7} onChange={(e) => set("accent_color", e.target.value)} {...aria("c-accent-hex", errors.accent_color)} />
              </div>
            </Field>
          </section>

          <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="vis-h">
            <h2 id="vis-h" className="text-lg font-semibold">Who can see it</h2>
            <div className="rounded-xl bg-surface-2 p-4 text-sm">
              <p className="font-medium">What becomes public when you publish</p>
              <p className="mt-1 text-muted">
                Everything you see in the preview: name, title, company, bio, photo, phone, email, website, address, social links and booking link, at <span className="break-all">{address}</span>. Anyone with the link can read it and download your contact. Do not enter anything you would not put on a business card. Your account, organization and other cards are never shown.
              </p>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium" id="pub-l">Published</p>
                <p className="text-sm text-muted">{form.published ? "Anyone with the link can open this card." : "Only you can see this card. Visitors get a not-found page."}</p>
              </div>
              <Switch checked={form.published} disabled={busy === "publish"} label="Published" onChange={togglePublished} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">Allow search engines</p>
                <p className="text-sm text-muted">Off by default: the page tells Google and others not to list it. Turn on if you want to be found by searching your name. Takes effect on save.</p>
              </div>
              <Switch checked={form.indexable} label="Allow search engines to list this card" onChange={(v) => set("indexable", v)} />
            </div>
          </section>

          <div aria-live="polite" className="min-h-6 text-sm">
            {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : notice ? <p className="text-muted">{notice}</p> : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={busy === "save" || atLimit}>{busy === "save" ? "Saving…" : card ? "Save changes" : "Create card"}</button>
            {card ? (
              confirmDelete ? (
                <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
                  <span className="text-sm">Delete this card for good? Its link and QR code stop working.</span>
                  <button type="button" className="btn" onClick={remove} disabled={busy === "delete"}>Yes, delete</button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </span>
              ) : (
                <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>Delete card</button>
              )
            ) : null}
          </div>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-6" aria-label="Live preview">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Preview</h2>
            <span className="text-xs text-muted">What visitors see</span>
          </div>
          <div
            className="rounded-3xl bg-bg p-3 ring-1 ring-line"
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest("a")) e.preventDefault();
            }}
          >
            <CardView card={preview} vcardHref="#" qrSrc={qrSrc} cardAddress={address} />
          </div>
          <div className="card flex flex-wrap gap-2 p-4">
            <button type="button" className="btn" onClick={copyLink} disabled={!cardUrl(form.slug, origin)}>Copy link</button>
            <button type="button" className="btn" onClick={downloadQr} disabled={!cardUrl(form.slug, origin)}>Download QR (PNG)</button>
            {card && form.published ? <a className="btn" href={`/c/${card.slug}`} target="_blank" rel="noopener noreferrer">Open public page</a> : null}
            <p className="w-full text-xs text-muted">The link and QR code work once the card is saved and published.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
