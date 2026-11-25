import Link from "next/link";
import { GUIDES } from "@/lib/guides";

export const metadata = { title: "Install guides · SignCraft" };

export default function GuidesPage() {
  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Install guides</p>
        <h1 className="text-3xl font-semibold tracking-tight">Put your signature in your email app.</h1>
        <p className="mt-3 max-w-xl text-muted">
          Build it in the <Link href="/editor" className="font-medium text-accent underline underline-offset-4">editor</Link>, use the buttons in the{" "}
          <Link href="/preview" className="font-medium text-accent underline underline-offset-4">exporter</Link>, then follow the steps for your app. Menu names change between versions, so look for the closest match.
        </p>
      </header>

      <nav aria-label="Email clients" className="mb-8 flex flex-wrap gap-2">
        {GUIDES.map((g) => (
          <a key={g.id} href={`#${g.id}`} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink">
            {g.name}
          </a>
        ))}
      </nav>

      <div className="space-y-5">
        {GUIDES.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-h`} className="card scroll-mt-20 p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`${g.id}-h`} className="text-lg font-semibold">{g.name}</h2>
              <span className="text-xs text-muted">Start with: {g.method}</span>
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed marker:text-muted">
              {g.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
            {g.note && <p className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-sm text-muted">{g.note}</p>}
          </section>
        ))}
      </div>

      <p className="mt-8 text-sm text-muted">Always send yourself a test email and open it in the apps your recipients use. Dark mode can recolour logos with transparent backgrounds.</p>
    </>
  );
}
