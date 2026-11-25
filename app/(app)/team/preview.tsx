"use client";

import { useMemo } from "react";
import { renderForPerson, type PersonData } from "@/lib/team/render";
import type { TemplateSpec } from "@/lib/team/template";

/** A signature built by the real renderer from a validated document, shown in a sandboxed frame (no scripts, no same-origin access). */
export function SignatureFrame({ html, title, className = "h-56" }: { html: string; title: string; className?: string }) {
  return <iframe title={title} sandbox="" srcDoc={`<!doctype html><html><body style="margin:16px;background:#fff;">${html}</body></html>`} className={`${className} w-full rounded-lg border border-line bg-white`} />;
}

/** Live preview for a person, a template and an employee's values. Shows the reason when the signature cannot be built. */
export function PersonPreview({ spec, person, values, title }: { spec: TemplateSpec; person: PersonData; values: Record<string, string>; title: string }) {
  const r = useMemo(() => renderForPerson(spec, person, values), [spec, person, values]);
  if (!r.ok) return <p role="alert" className="rounded-lg border border-line p-4 text-sm text-red-600 dark:text-red-400">{r.error}</p>;
  return <SignatureFrame html={r.html} title={title} />;
}
