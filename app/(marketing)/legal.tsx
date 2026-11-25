import type { Brand } from "@/lib/brand";

/** Banner, contents and typography shared by the privacy policy and the terms. */
export const DRAFT_BANNER = "DRAFT: requires review by a qualified lawyer before public use";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

export function LegalDoc({ title, intro, sections }: { title: string; intro: React.ReactNode; sections: LegalSection[] }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 md:py-14">
      <div role="note" className="mb-8 rounded-xl border-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-100">
        {DRAFT_BANNER}
      </div>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
      <div className="mt-4 space-y-3 leading-relaxed text-muted">{intro}</div>
      <nav aria-label="Contents" className="card mt-8 p-5">
        <p className="eyebrow text-muted">Contents</p>
        <ol className="mt-3 grid list-decimal gap-x-8 gap-y-1 pl-5 text-sm sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex min-h-9 items-center underline-offset-2 hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mt-10 space-y-10">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-24">
            <h2 className="text-xl font-semibold tracking-tight">
              {i + 1}. {s.title}
            </h2>
            <div className="mt-3 space-y-3 leading-relaxed [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">{s.body}</div>
          </section>
        ))}
      </div>
    </article>
  );
}

/** A detail the operator still has to decide or confirm. Visible on purpose, so it cannot be published by accident. */
export function Todo({ children }: { children: React.ReactNode }) {
  return <mark className="rounded bg-amber-100 px-1 text-amber-950 dark:bg-amber-900 dark:text-amber-100">[{children}]</mark>;
}

export function Operator({ brand }: { brand: Brand }) {
  return brand.companyIsPlaceholder ? <Todo>operator&apos;s legal name: set BRAND_COMPANY</Todo> : <>{brand.company}</>;
}

export function ContactLine({ brand }: { brand: Brand }) {
  return brand.contactEmail ? (
    <a className="underline underline-offset-2" href={`mailto:${brand.contactEmail}`}>
      {brand.contactEmail}
    </a>
  ) : (
    <Todo>contact email: set BRAND_CONTACT_EMAIL</Todo>
  );
}
