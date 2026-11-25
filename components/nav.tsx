"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { Icon as SolarIcon } from "@solar-icons/react/lib/types";
import { SidebarMinimalisticIcon } from "@solar-icons/react/linear/sidebar-minimalistic";
import { GalleryIcon } from "@solar-icons/react/linear/gallery";
import { PenNewSquareIcon } from "@solar-icons/react/linear/pen-new-square";
import { CodeSquareIcon } from "@solar-icons/react/linear/code-square";
import { HomeSmileIcon } from "@solar-icons/react/linear/home-smile";
import { LogoutIcon } from "@solar-icons/react/linear/logout";
import { LoginIcon } from "@solar-icons/react/linear/login";
import { StarsMinimalisticIcon } from "@solar-icons/react/linear/stars-minimalistic";
import { BookIcon } from "@solar-icons/react/linear/book";
import { CardIcon } from "@solar-icons/react/linear/card";
import { PaletteRoundIcon } from "@solar-icons/react/linear/palette-round";
import { UsersGroupTwoRoundedIcon } from "@solar-icons/react/linear/users-group-two-rounded";
import { UserPlusRoundedIcon } from "@solar-icons/react/linear/user-plus-rounded";
import { UserRoundedIcon } from "@solar-icons/react/linear/user-rounded";
import { RocketIcon } from "@solar-icons/react/linear/rocket";
import { RefreshIcon } from "@solar-icons/react/linear/refresh";
import { HeartPulseIcon } from "@solar-icons/react/linear/heart-pulse";
import { MegaphoneIcon } from "@solar-icons/react/linear/megaphone";
import { Chart2Icon } from "@solar-icons/react/linear/chart-2";
import { Tuning2Icon } from "@solar-icons/react/linear/tuning-2";
import { SliderVerticalIcon } from "@solar-icons/react/linear/slider-vertical";
import { DiplomaVerifiedIcon } from "@solar-icons/react/linear/diploma-verified";
import { TagIcon } from "@solar-icons/react/linear/tag";
import { Buildings2Icon } from "@solar-icons/react/linear/buildings-2";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/utils";
import { InviteDialog } from "@/components/invite-dialog";
import { currentLink, isActive, MAIN_LINKS, type IconKey, type NavGroup, type NavLink } from "@/lib/nav/menu";

const ICONS: Record<IconKey, SolarIcon> = {
  create: HomeSmileIcon, signatures: GalleryIcon, editor: PenNewSquareIcon, exporter: CodeSquareIcon, guides: BookIcon,
  people: UsersGroupTwoRoundedIcon, deploy: RocketIcon, sync: RefreshIcon, health: HeartPulseIcon, mine: UserRoundedIcon, invite: UserPlusRoundedIcon,
  card: CardIcon, polish: PaletteRoundIcon, campaigns: MegaphoneIcon, analytics: Chart2Icon,
  features: SliderVerticalIcon, limits: Tuning2Icon, disclaimers: DiplomaVerifiedIcon, plans: TagIcon, agency: Buildings2Icon,
};

/** What a screen reader hears for a link with a count. */
export const navLabel = (label: string, badge?: number) => (badge ? `${label}, ${badge} need attention` : label);

export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/icon-logo.png" alt="" aria-hidden="true" className={cn("size-10 shrink-0 object-contain", className)} />
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-4 text-primary-foreground lg:static lg:ml-auto lg:min-w-5 lg:px-1.5 lg:text-xs lg:leading-5">
      {n > 99 ? "99+" : n > 9 ? "9+" : n}
    </span>
  );
}

/** The one navigation menu: grouped, labelled on large screens, icons only on tablets. Phones use BottomNav. */
export function Sidebar({ email, role, groups, switcher, canInvite }: { email?: string | null; role?: string | null; groups: NavGroup[]; switcher?: React.ReactNode; canInvite?: boolean }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(document.documentElement.dataset.sidebar === "collapsed"), []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.dataset.sidebar = next ? "collapsed" : "expanded";
    try { localStorage.setItem("sidebar", next ? "collapsed" : "expanded"); } catch {}
  };
  const link = ({ href, label, icon, badge }: NavLink) => {
    const active = isActive(path, href);
    const Icon = ICONS[icon];
    return (
      <Link
        key={href}
        href={href}
        title={label}
        aria-label={navLabel(label, badge)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex h-10 items-center justify-center gap-3 rounded-2xl text-sm font-medium transition-colors duration-150 lg:exp:justify-start lg:exp:px-3",
          active ? "bg-[#ddb3a3] font-semibold text-[#171e2b] shadow-md" : "text-white/85 hover:bg-white/15 hover:text-white",
        )}
      >
        <Icon size={19} />
        <span className="hidden truncate lg:exp:inline">{label}</span>
        {badge ? <Badge n={badge} /> : null}
      </Link>
    );
  };
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[4.75rem] flex-col px-3 py-5 text-white md:flex lg:exp:w-60" aria-label="Sidebar">
      <div className="flex flex-col items-center gap-2 lg:exp:flex-row lg:exp:justify-between">
        <Link href="/create" aria-label="SignCraft home" className="flex min-w-0 items-center justify-center">
          <Logo className="size-11 lg:exp:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sig-craft-email-signatures-logo-white.png" alt="" aria-hidden="true" className="hidden h-14 w-auto max-w-full object-contain object-left lg:exp:block" />
        </Link>
        <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="hidden size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-white/80 transition-colors hover:bg-white/15 hover:text-white lg:flex">
          <SidebarMinimalisticIcon size={19} />
        </button>
      </div>
      {switcher && <div className="mt-4 hidden lg:exp:block">{switcher}</div>}

      <nav aria-label="Main" className="mt-6 flex flex-1 flex-col gap-0.5 no-scrollbar overflow-y-auto">
        {groups.map((g, i) => (
          <div key={g.label} className={i > 0 ? "mt-4" : undefined}>
            <p className="mb-1 hidden px-3 text-xs font-medium text-white/70 lg:exp:block">{g.label}</p>
            {i > 0 && <span aria-hidden="true" className="mx-2 mb-2 block h-px bg-white/25 lg:exp:hidden" />}
            <div className="flex flex-col gap-0.5">{g.links.map(link)}</div>
          </div>
        ))}
      </nav>

      <div className="mt-4 rounded-2xl bg-white/15 p-2 backdrop-blur lg:exp:p-3">
        <div className="flex items-center justify-center gap-3 lg:exp:justify-start">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ddb3a3] text-sm font-semibold uppercase text-[#171e2b]" aria-hidden="true">
            {(email ?? "S")[0]}
          </span>
          <div className="hidden min-w-0 lg:exp:block">
            <p className="truncate text-sm font-medium" title={email ?? undefined}>{email ?? "Guest"}</p>
            <p className="text-xs capitalize text-white/70">{role ?? "visitor"}</p>
          </div>
        </div>
        {!email && (
          <Link href={`/login?next=${encodeURIComponent(path)}`} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-full bg-[#ddb3a3] text-sm font-semibold text-[#171e2b] transition-colors hover:brightness-105">
            <LoginIcon size={17} />
            <span className="hidden lg:exp:inline">Sign in</span>
            <span className="sr-only lg:exp:hidden">Sign in</span>
          </Link>
        )}
        {email && canInvite && <InviteDialog />}
        {email && (
          <form action={signOut} className="mt-2">
            <button type="submit" aria-label={`Log out ${email}`} title="Log out" className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-white/40 text-sm font-medium text-white transition-colors hover:bg-white/15">
              <LogoutIcon size={17} />
              <span className="hidden lg:exp:inline">Log out</span>
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}

/** Where you are on the left, the main action and the account menu on the right. Phones get every other link in the account menu. */
export function Topbar({ email, groups }: { email?: string | null; groups: NavGroup[] }) {
  const path = usePathname();
  const here = currentLink(groups, path);
  const mainHrefs = new Set(MAIN_LINKS.map((l) => l.href));
  const more = groups.map((g) => ({ ...g, links: g.links.filter((l) => !mainHrefs.has(l.href)) })).filter((g) => g.links.length);
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 bg-background/90 px-4 backdrop-blur md:rounded-t-[28px] md:px-8">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{here?.group ?? "SignCraft"}</p>
        <p className="truncate text-lg font-semibold leading-tight tracking-tight">{here?.link.label ?? "Dashboard"}</p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/create/customize"
          aria-label="Create signature with AI"
          aria-current={path === "/create/customize" ? "page" : undefined}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-brand/10 px-3 text-sm font-medium text-brand transition-colors hover:bg-brand/20 sm:px-4"
        >
          <StarsMinimalisticIcon size={18} /> <span className="hidden sm:inline">Create with AI</span>
        </Link>
        {!email && (
          <Link href={`/login?next=${encodeURIComponent(path)}`} className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-primary-foreground">
            <LoginIcon size={18} /> Sign in
          </Link>
        )}
        {email && <details className="relative">
          <summary aria-label="Account menu" className="grid size-10 cursor-pointer list-none place-items-center rounded-full bg-brand text-sm font-semibold uppercase text-primary-foreground [&::-webkit-details-marker]:hidden">
            {(email ?? "S")[0]}
          </summary>
          <div className="absolute right-0 z-30 mt-2 max-h-[80vh] w-64 overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-xl">
            <p className="truncate px-3 py-2 text-sm font-medium" title={email ?? undefined}>{email ?? "Personal team"}</p>
            <div className="md:hidden">
              {more.map((g) => (
                <div key={g.label}>
                  <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>
                  {g.links.map(({ href, label, icon, badge }) => {
                    const Icon = ICONS[icon];
                    return (
                      <Link key={href} href={href} aria-label={navLabel(label, badge)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm transition-colors hover:bg-secondary">
                        <Icon size={18} /> {label}
                        {badge ? <span aria-hidden="true" className="ml-auto rounded-full bg-brand px-2 text-xs font-semibold leading-5 text-primary-foreground">{badge > 99 ? "99+" : badge}</span> : null}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
            {email && (
              <form action={signOut} className="mt-1 border-t border-border pt-1">
                <button type="submit" className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-brand transition-colors hover:bg-secondary">
                  <LogoutIcon size={18} /> Log out
                </button>
              </form>
            )}
          </div>
        </details>}
      </div>
    </header>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-2 bottom-2 z-20 flex rounded-2xl border border-border bg-card shadow-lg md:hidden">
      {MAIN_LINKS.map(({ href, label, icon }) => {
        const active = isActive(path, href);
        const Icon = ICONS[icon];
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium", active ? "text-brand" : "text-muted-foreground")}
          >
            <Icon size={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Slim footer under every page. */
export function Footer() {
  return (
    <footer className="px-4 py-5 text-xs text-muted-foreground md:px-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 pb-16 md:pb-0">
        <p>&copy; {new Date().getFullYear()} SignCraft. Email signatures that look right everywhere.</p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="/guides" className="hover:text-foreground">Install guides</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
