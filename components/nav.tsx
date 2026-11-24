"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Icon as SolarIcon } from "@solar-icons/react/lib/types";
import { StarsIcon } from "@solar-icons/react/bold-duotone/stars";
import { GalleryIcon } from "@solar-icons/react/bold-duotone/gallery";
import { PenNewSquareIcon } from "@solar-icons/react/bold-duotone/pen-new-square";
import { CodeSquareIcon } from "@solar-icons/react/bold-duotone/code-square";
import { HomeSmileIcon } from "@solar-icons/react/bold-duotone/home-smile";
import { QuestionCircleIcon } from "@solar-icons/react/bold-duotone/question-circle";
import { LogoutIcon } from "@solar-icons/react/bold-duotone/logout";
import { FolderIcon } from "@solar-icons/react/bold-duotone/folder";
import { AddCircleIcon } from "@solar-icons/react/bold-duotone/add-circle";
import { LayersIcon } from "@solar-icons/react/bold-duotone/layers";
import { DocumentTextIcon } from "@solar-icons/react/bold-duotone/document-text";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Item = { href: string; label: string; Icon: SolarIcon };

// Max 5 items (PROJECT.md section 14). Team arrives in a later phase.
const ITEMS: Item[] = [
  { href: "/create", label: "Create", Icon: HomeSmileIcon },
  { href: "/signatures", label: "Signatures", Icon: GalleryIcon },
  { href: "/editor", label: "Editor", Icon: PenNewSquareIcon },
  { href: "/preview", label: "Exporter", Icon: CodeSquareIcon },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-9 place-items-center rounded-xl bg-brand text-white", className)} aria-hidden="true">
      <StarsIcon size={20} />
    </span>
  );
}

/** Slim icon rail, the primary navigation on desktop. */
export function Rail({ email }: { email?: string | null }) {
  const path = usePathname();
  return (
    <TooltipProvider>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-14 flex-col items-center border-r border-border bg-card py-3 md:flex">
        <Link href="/create" aria-label="SignCraft home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="mt-6 flex flex-col gap-2">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = path.startsWith(href);
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "grid size-10 place-items-center rounded-xl transition-colors duration-150",
                      active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon size={22} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-2">
          {email && (
            <form action={signOut}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="submit" aria-label={`Sign out ${email}`} className="grid size-10 cursor-pointer place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    <LogoutIcon size={22} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
            </form>
          )}
          <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold uppercase text-primary-foreground" aria-hidden="true">
            {(email ?? "S")[0]}
          </span>
        </div>
      </aside>
    </TooltipProvider>
  );
}

/** Contextual side panel, mirrors the reference's "New task / Inspirations / Project" column. */
export function Panel() {
  const path = usePathname();
  const row = (active: boolean) =>
    cn(
      "flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors duration-150",
      active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
    );
  return (
    <aside className="fixed inset-y-0 left-14 z-10 hidden w-56 flex-col border-r border-border bg-background px-3 pt-4 lg:flex" aria-label="Workspace">
      <p className="px-3 pb-3 text-sm font-semibold">Home</p>
      <Link href="/create" className={row(path.startsWith("/create"))}>
        <AddCircleIcon size={18} /> New signature
      </Link>
      <Link href="/signatures" className={row(path === "/signatures")}>
        <LayersIcon size={18} /> Templates
      </Link>
      <Link href="/preview" className={row(path.startsWith("/preview"))}>
        <DocumentTextIcon size={18} /> Exporter
      </Link>

      <p className="mt-6 px-3 pb-2 text-xs font-medium text-muted-foreground">Project</p>
      <Link href="/signatures#mine" className={row(false)}>
        <FolderIcon size={18} /> My signatures
      </Link>
      <Link href="/editor" className={row(path.startsWith("/editor"))}>
        <FolderIcon size={18} /> Current draft
      </Link>
    </aside>
  );
}

export function Topbar({ email }: { email?: string | null }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
      <span className="inline-flex h-9 max-w-[50%] items-center rounded-lg border border-border bg-card px-3 text-sm">
        <span className="truncate" title={email ?? undefined}>{email ?? "Personal team"}</span>
      </span>
      <div className="flex items-center gap-2">
        <Link href="/signatures" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm transition-colors hover:bg-secondary">
          <QuestionCircleIcon size={18} /> Help
        </Link>
        <Link href="/preview" className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm transition-colors hover:bg-secondary sm:inline-flex">
          <DocumentTextIcon size={18} /> Docs
        </Link>
      </div>
    </header>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-card md:hidden">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium", active ? "text-foreground" : "text-muted-foreground")}
          >
            <Icon size={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
