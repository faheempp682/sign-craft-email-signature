"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { call, Status } from "../api";
import { HistoryTab } from "./history-tab";
import { OverviewTab } from "./overview-tab";
import { ReviewTab } from "./review-tab";
import { RulesTab } from "./rules-tab";
import { SettingsTab } from "./settings-tab";
import type { StatusData } from "./sync-types";

const TABS = [
  { id: "overview", label: "Sources" },
  { id: "review", label: "Review changes" },
  { id: "rules", label: "Rules and mapping" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function SyncDashboard() {
  const [tab, setTab] = useState<TabId>("overview");
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call<StatusData>("GET", "/api/sync/status");
    if (r.ok) {
      setStatus(r.data);
      setLoadError("");
    } else setLoadError(r.message);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function review(id: string) {
    setReviewId(id);
    setTab("review");
  }

  return (
    <div>
      <div role="tablist" aria-label="Sync sections" className="flex gap-1 overflow-x-auto border-b border-line">
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
        <Status error={loadError} notice="" />
        {status && tab === "overview" && <OverviewTab status={status} onReview={review} onChanged={load} />}
        {status && tab === "review" && <ReviewTab status={status} previewId={reviewId} onPick={setReviewId} onChanged={load} />}
        {status && tab === "rules" && <RulesTab status={status} onChanged={load} />}
        {status && tab === "history" && <HistoryTab status={status} />}
        {status && tab === "settings" && <SettingsTab status={status} onChanged={load} />}
        {!status && !loadError && <p className="text-sm text-muted">Loading…</p>}
      </div>
    </div>
  );
}
