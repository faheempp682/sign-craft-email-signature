import Link from "next/link";
import { getBrand } from "@/lib/brand";
import { NICHES } from "@/lib/site/niches";
import { HamburgerMenuIcon } from "@solar-icons/react/bold-duotone/hamburger-menu";

/**
 * Header, footer and page frame shared by every marketing page. app/(marketing)/layout.tsx uses it, and so does
 * app/page.tsx (the home page lives at the app root, outside the route group, so it wraps itself).
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  const brand = getBrand();
  const nav = [
    { href: "/signature-generator", label: "Free generator" },
    ...NICHES.map((n) => ({ href: `/for/${n.slug}`, label: n.label })),
  ];
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-3">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-h-11 items-center text-lg font-semibold tracking-tight">
            {brand.name}
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {nav.map((l) => (
              <Link key={l.href} href={l.href} className="flex min-h-11 items-center rounded-lg px-3 text-sm text-muted hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn hidden whitespace-nowrap sm:inline-flex">
              Sign in
            </Link>
            <Link href="/signature-generator" className="btn btn-primary whitespace-nowrap">
              <span className="sm:hidden">Make one</span>
              <span className="hidden sm:inline">Make a signature</span>
            </Link>
            <details className="relative lg:hidden">
              <summary aria-label="Menu" className="btn list-none px-3 [&::-webkit-details-marker]:hidden">
                <HamburgerMenuIcon className="size-5" aria-hidden />
              </summary>
              <div className="card absolute right-0 top-14 flex w-64 flex-col p-2 shadow-lg">
                {nav.map((l) => (
                  <Link key={l.href} href={l.href} className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-surface-2">
                    {l.label}
                  </Link>
                ))}
                <Link href="/login" className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-surface-2">
                  Sign in
                </Link>
              </div>
            </details>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-10 sm:grid-cols-2 md:grid-cols-4">
          <div className="sm:col-span-2 md:col-span-1">
            <p className="font-semibold">{brand.name}</p>
            <p className="mt-2 max-w-xs text-sm text-muted">{brand.tagline}</p>
          </div>
          <FooterList title="Product" links={[{ href: "/signature-generator", label: "Free signature generator" }, { href: "/login", label: "Sign in" }]} />
          <FooterList title="Who it is for" links={NICHES.map((n) => ({ href: `/for/${n.slug}`, label: n.label }))} />
          <FooterList title="Legal" links={[{ href: "/privacy", label: "Privacy policy" }, { href: "/terms", label: "Terms of service" }]} />
        </div>
        <div className="border-t border-line">
          <p className="mx-auto w-full max-w-5xl px-4 py-5 text-sm text-muted">
            &copy; {new Date().getFullYear()} {brand.companyIsPlaceholder ? brand.name : brand.company}.
            {brand.contactEmail && (
              <>
                {" "}
                Contact: <a className="underline underline-offset-2" href={`mailto:${brand.contactEmail}`}>{brand.contactEmail}</a>
              </>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterList({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="eyebrow text-muted">{title}</p>
      <ul className="mt-3 space-y-1">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex min-h-11 items-center text-sm text-muted hover:text-ink sm:min-h-9">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
