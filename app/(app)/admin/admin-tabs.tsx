"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** `platform` tabs change settings for the whole installation, so only platform admins (admins of the default organization) see them. */
const TABS = [
  { href: "/admin/features", label: "Features", platform: true },
  { href: "/admin/limits", label: "AI limits", platform: true },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/disclaimers", label: "Disclaimers" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/users", label: "People", platform: true },
];

export function AdminTabs({ platform = true }: { platform?: boolean }) {
  const path = usePathname();
  const tabs = TABS.filter((t) => platform || !("platform" in t && t.platform));
  return (
    <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const active = path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors duration-150",
              active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
