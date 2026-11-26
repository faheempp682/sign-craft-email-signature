"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

const MOBILE_NAV_EVENT = "mobile-nav";
/** Phones: the header button and the icon rail share one open/closed state. */
function useMobileNav() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setOpen(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(MOBILE_NAV_EVENT, on);
    return () => window.removeEventListener(MOBILE_NAV_EVENT, on);
  }, []);
  const set = (v: boolean) => { setOpen(v); document.documentElement.dataset.mobileNav = v ? "open" : "closed"; window.dispatchEvent(new CustomEvent(MOBILE_NAV_EVENT, { detail: v })); };
  return [open, set] as const;
}

/** What a screen reader hears for a link with a count. */
export const navLabel = (label: string, badge?: number) => (badge ? `${label}, ${badge} need attention` : label);

export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/icon-logo.png" alt="" aria-hidden="true" className={cn("size-10 shrink-0 object-contain", className)} />
  );
}

/** The person's picture, or their first letter when they have none. */
function Avatar({ url, email, className }: { url?: string | null; email?: string | null; className: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" aria-hidden="true" className={cn("shrink-0 rounded-full object-cover", className)} />;
  }
  return <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full text-sm font-semibold uppercase", className)}>{(email ?? "S")[0]}</span>;
}

function Badge({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-4 text-primary-foreground lg:static lg:ml-auto lg:min-w-5 lg:px-1.5 lg:text-xs lg:leading-5">
      {n > 99 ? "99+" : n > 9 ? "9+" : n}
    </span>
  );
}

/** The one navigation menu: grouped, labelled on large screens, icons only on tablets. Phones use BottomNav. */
export function Sidebar({ email, avatarUrl, role, groups, switcher, canInvite }: { email?: string | null; avatarUrl?: string | null; role?: string | null; groups: NavGroup[]; switcher?: React.ReactNode; canInvite?: boolean }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(document.documentElement.dataset.sidebar === "collapsed"), []);
  const [mOpen, setMOpen] = useMobileNav();
  useEffect(() => setMOpen(false), [path]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <>
    <aside data-open={mOpen} className="group/side fixed inset-y-0 left-0 z-20 flex w-14 max-md:-translate-x-full max-md:transition-[transform,visibility] max-md:duration-300 max-md:ease-out max-md:data-[open=true]:translate-x-0 max-md:data-[open=false]:invisible flex-col bg-[#171e2b] px-2 py-4 text-white md:w-[4.75rem] md:bg-transparent md:px-3 md:py-5 lg:exp:w-60" aria-label="Sidebar">
      <div className="flex flex-col items-center gap-2 lg:exp:flex-row lg:exp:justify-between">
        <Link href="/create" aria-label="SignCraft home" className="flex min-w-0 items-center justify-center">
          <Logo className="size-9 md:size-11 lg:exp:hidden" />
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

      <div className="mt-4 rounded-2xl bg-white/15 p-1 backdrop-blur md:p-2 lg:exp:p-3">
        <div className="flex items-center justify-center gap-3 lg:exp:justify-start">
          <Avatar url={avatarUrl} email={email} className="size-9 bg-[#ddb3a3] text-[#171e2b]" />
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
      </div>
    </aside>
    </>
  );
}

/** Where you are on the left, the main action and the account menu on the right. Phones get every other link in the account menu. */
export function Topbar({ email, avatarUrl, groups }: { email?: string | null; avatarUrl?: string | null; groups: NavGroup[] }) {
  const path = usePathname();
  const [navOpen, setNavOpen] = useMobileNav();
  const here = path === "/settings" ? { group: "Account", link: { href: "/settings", label: "Settings", icon: "mine" as const } } : currentLink(groups, path);
  const menu = useRef<HTMLDetailsElement>(null);
  // The account menu closes on a click outside it, on Escape, and when the page changes.
  useEffect(() => {
    const el = menu.current;
    if (el) el.open = false;
  }, [path]);
  useEffect(() => {
    const close = (e: Event) => {
      const el = menu.current;
      if (el?.open && !(e.target instanceof Node && el.contains(e.target))) el.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  const mainHrefs = new Set(MAIN_LINKS.map((l) => l.href));
  const more = groups.map((g) => ({ ...g, links: g.links.filter((l) => !mainHrefs.has(l.href)) })).filter((g) => g.links.length);
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 bg-background/90 px-4 backdrop-blur md:rounded-t-[28px] md:px-8">
      <button type="button" onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen} aria-label={navOpen ? "Close menu" : "Open menu"} className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-foreground transition-colors hover:bg-secondary md:hidden">
        <SidebarMinimalisticIcon size={22} />
      </button>
      <div className="min-w-0 flex-1">
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
        {email && <details ref={menu} className="relative">
          <summary aria-label="Account menu" className="block size-10 cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden">
            <Avatar url={avatarUrl} email={email} className="size-10 bg-brand text-primary-foreground" />
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
            <Link href="/settings" className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm transition-colors hover:bg-secondary">
              <UserRoundedIcon size={18} /> Account settings
            </Link>
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
