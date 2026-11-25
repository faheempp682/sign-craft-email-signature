"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function PolishTabs({ isDesigner }: { isDesigner: boolean }) {
  const path = usePathname();
  const tabs = [
    { href: "/polish", label: "My requests", active: path === "/polish" || (path.startsWith("/polish/") && !path.startsWith("/polish/queue")) },
    ...(isDesigner ? [{ href: "/polish/queue", label: "Queue", active: path.startsWith("/polish/queue") }] : []),
  ];
  return (
    <nav aria-label="Designer polish sections" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors duration-150",
            t.active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
