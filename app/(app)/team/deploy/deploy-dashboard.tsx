"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { DeploymentView } from "./deployment-view";
import { ExchangeTab } from "./exchange-tab";
import { GmailTab } from "./gmail-tab";
import { HistoryTab } from "./history-tab";
import { RulesTab } from "./rules-tab";

const TABS = [
  { id: "gmail", label: "Gmail" },
  { id: "exchange", label: "Microsoft 365" },
  { id: "rules", label: "Rules" },
  { id: "history", label: "History" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function DeployDashboard({ initialTab = "gmail" }: { initialTab?: TabId }) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [open, setOpen] = useState<string | null>(null);

  function show(id: string) {
    setOpen(id);
    setTab("history");
  }

  return (
    <div>
      <div role="tablist" aria-label="Deploy sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`dtab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`dpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => {
              setTab(t.id);
              if (t.id !== "history") setOpen(null);
            }}
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.id === tab);
              const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
              if (next) {
                e.preventDefault();
                setTab(next.id);
                document.getElementById(`dtab-${next.id}`)?.focus();
              }
            }}
            className={cn(
              "-mb-px inline-flex min-h-11 cursor-pointer items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors duration-150",
              tab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`dpanel-${tab}`} aria-labelledby={`dtab-${tab}`} className="mt-8">
        {tab === "gmail" && <GmailTab onStarted={show} />}
        {tab === "exchange" && <ExchangeTab />}
        {tab === "rules" && <RulesTab />}
        {tab === "history" && (open ? <DeploymentView key={open} id={open} onOpen={setOpen} onBack={() => setOpen(null)} /> : <HistoryTab onOpen={setOpen} />)}
      </div>
    </div>
  );
}
