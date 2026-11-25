"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ApprovalsTab } from "./approvals-tab";
import { ImportTab } from "./import-tab";
import { PeopleTab } from "./people-tab";
import { SettingsTab } from "./settings-tab";
import { TemplatesTab } from "./templates-tab";

const TABS = [
  { id: "people", label: "People" },
  { id: "import", label: "Import" },
  { id: "templates", label: "Brand templates" },
  { id: "approvals", label: "Approvals" },
  { id: "settings", label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function TeamDashboard({ initialTab = "people" }: { initialTab?: TabId }) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [peopleKey, setPeopleKey] = useState(0); // remount the list after an import so it reloads

  return (
    <div>
      <div role="tablist" aria-label="Team sections" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.id === tab);
              const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
              if (next) {
                e.preventDefault();
                setTab(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
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
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-8">
        {tab === "people" && <PeopleTab key={peopleKey} onImport={() => setTab("import")} />}
        {tab === "import" && <ImportTab onDone={() => setPeopleKey((k) => k + 1)} />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "approvals" && <ApprovalsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
