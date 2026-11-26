"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EMPTY_DETAILS, validateDetails, type Details } from "@/lib/create/fill";
import { loadDetails, saveDetails } from "@/lib/create/session";

export type Spec = { key: keyof Details; label: string; placeholder: string; type?: string; autoComplete?: string; required?: boolean; wide?: boolean };

export const ABOUT: Spec[] = [
  { key: "name", label: "Full name", placeholder: "Jane Cooper", autoComplete: "name", required: true },
  { key: "title", label: "Job title", placeholder: "Head of Sales", autoComplete: "organization-title" },
  { key: "company", label: "Company", placeholder: "Acme Inc.", autoComplete: "organization" },
];
export const REACH: Spec[] = [
  { key: "phone", label: "Phone", placeholder: "+1 555 123 4567", type: "tel", autoComplete: "tel" },
  { key: "email", label: "Email", placeholder: "jane@acme.com", type: "email", autoComplete: "email" },
  { key: "website", label: "Website", placeholder: "acme.com", autoComplete: "url" },
  { key: "address", label: "Address", placeholder: "12 High Street, London", autoComplete: "street-address", wide: true },
];
export const SOCIAL: Spec[] = [
  { key: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/janecooper or janecooper" },
  { key: "twitter", label: "X (Twitter)", placeholder: "@janecooper" },
  { key: "instagram", label: "Instagram", placeholder: "@janecooper" },
  { key: "facebook", label: "Facebook", placeholder: "facebook.com/janecooper or janecooper" },
  { key: "youtube", label: "YouTube", placeholder: "@janecooper" },
  { key: "github", label: "GitHub", placeholder: "janecooper" },
];
/** Networks shown for every template with a social block; the others only when the template itself has them. */
export const COMMON_SOCIAL = ["linkedin", "twitter", "instagram"];
export const NOTE: Spec[] = [{ key: "note", label: "Footer line", placeholder: "Services offered, a tagline or a short notice", wide: true }];
export const BUTTON: Spec[] = [
  { key: "buttonLabel", label: "Button text", placeholder: "Book a call" },
  { key: "buttonUrl", label: "Button link", placeholder: "acme.com/book", type: "url" },
];

export function DetailsForm({ templateId, templateName }: { templateId: string; templateName: string }) {
  const router = useRouter();
  const [d, setD] = useState<Details>(EMPTY_DETAILS);
  const [errors, setErrors] = useState<Partial<Record<keyof Details, string>>>({});
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const saved = loadDetails();
    if (saved) setD(saved);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateDetails(d);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`f-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    if (!saveDetails(d)) return setBlocked(true);
    router.push(`/create/preview?t=${encodeURIComponent(templateId)}`);
  }

  const field = (s: Spec) => (
    <div key={s.key} className={s.wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={`f-${s.key}`} className="mb-1 block text-sm font-medium">
        {s.label}
        {!s.required && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      <input
        id={`f-${s.key}`}
        className="field w-full"
        type={s.type ?? "text"}
        autoComplete={s.autoComplete}
        placeholder={s.placeholder}
        value={d[s.key]}
        maxLength={s.key === "name" || s.key === "title" || s.key === "company" ? 100 : 200}
        aria-invalid={!!errors[s.key]}
        aria-describedby={errors[s.key] ? `e-${s.key}` : undefined}
        onChange={(e) => setD({ ...d, [s.key]: e.target.value })}
      />
      {errors[s.key] && <p id={`e-${s.key}`} className="mt-1 text-sm text-red-600 dark:text-red-400">{errors[s.key]}</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-8">
        <Link href={`/create?t=${encodeURIComponent(templateId)}`} className="mb-4 inline-block text-sm text-muted hover:text-ink">&larr; Back</Link>
        <p className="eyebrow mb-2">Step 2 of 3</p>
        <h1 className="text-3xl font-semibold tracking-tight">Tell us about you.</h1>
        <p className="mt-3 text-muted">
          We will fill in <strong className="font-medium text-ink">{templateName}</strong> with these. Only your name is required, and anything you leave blank is left out.
        </p>
      </header>

      <form onSubmit={submit} noValidate className="space-y-8">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-lg font-semibold">About you</legend>
          {ABOUT.map(field)}
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-lg font-semibold">How to reach you</legend>
          {REACH.map(field)}
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-lg font-semibold">Social links</legend>
          {SOCIAL.map(field)}
        </fieldset>

        {blocked && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Your browser is blocking site storage, so we cannot carry your details to the next step. Allow site data and try again.</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
          <Link href="/create" className="text-sm text-muted hover:text-ink">&larr; Choose a different template</Link>
          <button type="submit" className="btn btn-primary min-h-11">See my signature</button>
        </div>
      </form>
    </div>
  );
}
