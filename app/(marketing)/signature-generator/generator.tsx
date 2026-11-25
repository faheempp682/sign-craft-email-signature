"use client";

/**
 * The free generator. Everything happens in this component: no fetch, no form post, no upload, no account, no AI.
 * That is deliberate, so the page has no server-side abuse surface. generator.test.tsx fails if it ever calls fetch.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { copyHtmlRich, downloadHtm } from "@/lib/export-client";
import { CATEGORIES } from "@/lib/presets";
import { renderToEmailHtml } from "@/lib/renderer/email-html";
import { GENERATOR_NETWORKS, GENERATOR_TEMPLATES, buildDoc, defaultInput, validateInput, type FieldErrors, type GeneratorInput } from "@/lib/site/generator";
import { CopyIcon } from "@solar-icons/react/bold-duotone/copy";
import { DownloadMinimalisticIcon } from "@solar-icons/react/bold-duotone/download-minimalistic";
import { SignatureFrame } from "../signature-frame";
import { PreviewShell } from "../ui";

const NETWORK_LABEL: Record<(typeof GENERATOR_NETWORKS)[number], string> = { linkedin: "LinkedIn", twitter: "X (Twitter)", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", github: "GitHub" };
const SAMPLE = { name: "Your Name", title: "Your title", company: "Your company", phone: "+1 555 0100", email: "you@company.com", website: "company.com" };

/** What the preview shows: placeholders for empty text, and any field that is currently invalid is left out. */
function previewInput(input: GeneratorInput, errors: FieldErrors): GeneratorInput {
  const next: GeneratorInput = { ...input, socials: { ...input.socials } };
  for (const k of ["name", "title", "company", "phone", "email", "website"] as const) if (!next[k].trim() || errors[k]) next[k] = SAMPLE[k];
  if (errors.photoUrl) next.photoUrl = "";
  if (errors.accent) next.accent = defaultInput(input.templateId).accent;
  for (const n of GENERATOR_NETWORKS) if (errors[`social_${n}`]) next.socials[n] = "";
  return next;
}

export function SignatureGenerator() {
  const [input, setInput] = useState<GeneratorInput>(() => defaultInput());
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const errors = useMemo(() => validateInput(input), [input]);
  // Required fields only complain after an attempt; format errors show as soon as something is typed.
  const shown: FieldErrors = { ...errors };
  if (!submitted) delete shown.name;

  const preview = useMemo(() => {
    const r = buildDoc(previewInput(input, errors));
    return r.ok ? renderToEmailHtml(r.doc) : null;
  }, [input, errors]);

  const set = <K extends keyof Omit<GeneratorInput, "socials">>(k: K, v: GeneratorInput[K]) => {
    setStatus(null);
    setInput((p) => (k === "templateId" ? { ...p, templateId: v as string, accent: defaultInput(v as string).accent } : { ...p, [k]: v }));
  };
  const setSocial = (n: (typeof GENERATOR_NETWORKS)[number], v: string) => {
    setStatus(null);
    setInput((p) => ({ ...p, socials: { ...p.socials, [n]: v } }));
  };

  const finalHtml = (): string | null => {
    setSubmitted(true);
    const r = buildDoc(input);
    if (!r.ok) {
      setStatus({ kind: "error", text: "Fix the highlighted fields first." });
      return null;
    }
    return renderToEmailHtml(r.doc);
  };

  const onCopy = async () => {
    const html = finalHtml();
    if (!html) return;
    setStatus((await copyHtmlRich(html)) ? { kind: "ok", text: "Copied. Paste it into your mail app's signature settings." } : { kind: "error", text: "Your browser blocked copying. Use Download instead." });
  };
  const onDownload = () => {
    const html = finalHtml();
    if (!html) return;
    downloadHtm(html, `${input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "email"}-signature.htm`);
    setStatus({ kind: "ok", text: "Downloaded. Open the file in a browser, select the signature, copy it and paste it into your mail app." });
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <form onSubmit={(e) => e.preventDefault()} noValidate aria-label="Signature details" className="order-2 grid content-start gap-5 lg:order-1">
        <Field id="g-template" label="Template">
          <select id="g-template" className="field w-full" value={input.templateId} onChange={(e) => set("templateId", e.target.value)}>
            {CATEGORIES.map((c) => {
              const list = GENERATOR_TEMPLATES.filter((t) => t.category === c);
              return list.length ? (
                <optgroup key={c} label={c}>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="g-name" label="Full name" error={shown.name} required>
            <input id="g-name" className="field w-full" autoComplete="name" value={input.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!shown.name} aria-describedby={shown.name ? "g-name-err" : undefined} />
          </Field>
          <Field id="g-title" label="Job title" error={shown.title}>
            <input id="g-title" className="field w-full" autoComplete="organization-title" value={input.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field id="g-company" label="Company" error={shown.company}>
            <input id="g-company" className="field w-full" autoComplete="organization" value={input.company} onChange={(e) => set("company", e.target.value)} />
          </Field>
          <Field id="g-phone" label="Phone" error={shown.phone}>
            <input id="g-phone" type="tel" className="field w-full" autoComplete="tel" value={input.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field id="g-email" label="Email" error={shown.email}>
            <input id="g-email" type="email" className="field w-full" autoComplete="email" value={input.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!shown.email} aria-describedby={shown.email ? "g-email-err" : undefined} />
          </Field>
          <Field id="g-website" label="Website" error={shown.website}>
            <input id="g-website" className="field w-full" inputMode="url" autoComplete="url" placeholder="company.com" value={input.website} onChange={(e) => set("website", e.target.value)} aria-invalid={!!shown.website} aria-describedby={shown.website ? "g-website-err" : undefined} />
          </Field>
        </div>

        <Field id="g-accent" label="Accent colour" error={shown.accent}>
          <div className="flex items-center gap-3">
            <input id="g-accent" type="color" value={/^#[0-9a-fA-F]{6}$/.test(input.accent) ? input.accent : "#111111"} onChange={(e) => set("accent", e.target.value)} className="h-11 w-16 cursor-pointer rounded-lg border border-line bg-surface p-1" />
            <span className="font-mono text-sm text-muted">{input.accent}</span>
          </div>
        </Field>

        <fieldset className="grid gap-5 rounded-2xl border border-line p-4">
          <legend className="px-2 text-sm font-medium">Social links (optional)</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            {GENERATOR_NETWORKS.map((n) => (
              <Field key={n} id={`g-social-${n}`} label={NETWORK_LABEL[n]} error={shown[`social_${n}`]}>
                <input id={`g-social-${n}`} className="field w-full" inputMode="url" placeholder="Paste the profile link" value={input.socials[n]} onChange={(e) => setSocial(n, e.target.value)} aria-invalid={!!shown[`social_${n}`]} aria-describedby={shown[`social_${n}`] ? `g-social-${n}-err` : undefined} />
              </Field>
            ))}
          </div>
        </fieldset>

        <Field id="g-photo" label="Photo link (optional)" error={shown.photoUrl} hint="A picture that is already online at an https:// address. We never upload files; to upload a photo or logo, use an account.">
          <input id="g-photo" className="field w-full" inputMode="url" placeholder="https://" value={input.photoUrl} onChange={(e) => set("photoUrl", e.target.value)} aria-invalid={!!shown.photoUrl} aria-describedby={shown.photoUrl ? "g-photo-err" : undefined} />
        </Field>
      </form>

      <div className="order-1 grid content-start gap-4 lg:sticky lg:top-24 lg:order-2 lg:self-start">
        <PreviewShell caption="Preview on a white page, the way most mail apps show it.">{preview ? <SignatureFrame html={preview} title="Your signature preview" minHeight={160} /> : <p className="p-6 text-sm text-neutral-600">The preview could not be built. Check the fields.</p>}</PreviewShell>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" className="btn btn-primary" onClick={onCopy}>
            <CopyIcon className="size-4" aria-hidden />
            Copy signature
          </button>
          <button type="button" className="btn" onClick={onDownload}>
            <DownloadMinimalisticIcon className="size-4" aria-hidden />
            Download .htm
          </button>
        </div>
        <p role="status" aria-live="polite" className={`min-h-5 text-sm ${status?.kind === "error" ? "text-red-700 dark:text-red-300" : "text-muted"}`}>
          {status?.text}
        </p>

        <div className="card p-5">
          <p className="font-semibold">Want to keep this?</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">This page remembers nothing, so your work is gone when you close it. Sign in to save and edit signatures, fill details with AI from pasted text or a website, upload a photo or logo, and use team features.</p>
          <Link href="/login" className="btn mt-4">
            Sign in or create an account
          </Link>
        </div>

        <details className="card px-5 py-3 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">How to add it to your mail app</summary>
          <ol className="mt-2 list-decimal space-y-2 pb-2 pl-5 leading-relaxed text-muted">
            <li>Press Copy signature.</li>
            <li>Open your mail app&apos;s settings and find the signature box.</li>
            <li>Paste. Check it looks right, then save.</li>
            <li>Send yourself a test message and look at it, ideally on your phone as well. Mail apps differ, and we have not verified every one.</li>
          </ol>
        </details>
      </div>
    </div>
  );
}

function Field({ id, label, error, hint, required, children }: { id: string; label: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="text-muted"> (required)</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
