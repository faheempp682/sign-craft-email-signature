import Link from "next/link";
import { jsonLdString, type FaqItem } from "@/lib/site/seo";
import { ArrowRightIcon } from "@solar-icons/react/bold-duotone/arrow-right";

/** Structured data. The string is escaped so page copy can never close the script tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}

export function Section({ eyebrow, title, children, id }: { eyebrow?: string; title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mx-auto w-full max-w-5xl px-4 py-12 md:py-16">
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <h2 className="max-w-3xl text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
      <div className="mt-8">{children}</div>
    </section>
  );
}

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {items.map((i) => (
        <details key={i.q} className="group px-5 py-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-left font-medium [&::-webkit-details-marker]:hidden">
            {i.q}
            <span aria-hidden className="text-muted transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="pb-2 pt-1 leading-relaxed text-muted">{i.a}</p>
        </details>
      ))}
    </div>
  );
}

export function CtaBand({ title, body, primary, secondary }: { title: string; body: string; primary: { href: string; label: string }; secondary?: { href: string; label: string } }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12 md:py-16">
      <div className="card flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-10">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-2 text-muted">{body}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href={primary.href} className="btn btn-primary">
            {primary.label}
            <ArrowRightIcon className="size-4" aria-hidden />
          </Link>
          {secondary && (
            <Link href={secondary.href} className="btn">
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

/** The signature is shown on white, because that is how most mail apps show it. */
export function PreviewShell({ children, caption }: { children: React.ReactNode; caption?: string }) {
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">{children}</div>
      {caption && <figcaption className="mt-2 text-sm text-muted">{caption}</figcaption>}
    </figure>
  );
}
