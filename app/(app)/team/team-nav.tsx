"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type TeamNavItem = { href: string; label: string };

/** Section links shared by every admin team page. The server decides which items exist (feature flags); this only draws them. */
export function TeamNav({ items }: { items: TeamNavItem[] }) {
  const path = usePathname();
  // "/team" must match exactly, or it would light up on every sub-page.
  const active = (href: string) => (href === "/team" ? path === "/team" : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Team sections" className="mb-8 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={active(i.href) ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors duration-150",
            active(i.href) ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
