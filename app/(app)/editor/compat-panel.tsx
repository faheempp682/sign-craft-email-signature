"use client";

import { scoreOf, type Issue, type Severity } from "@/lib/linter";

const LABEL: Record<Severity, string> = { error: "Fix", warning: "Check", info: "Tip" };
const TONE: Record<Severity, string> = {
  error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  info: "bg-surface-2 text-muted",
};

export function CompatPanel({
  issues,
  onFix,
  onFixAll,
  onSelect,
}: {
  issues: Issue[];
  onFix: (issue: Issue) => void;
  onFixAll: () => void;
  onSelect: (blockIndex: number) => void;
}) {
  const score = scoreOf(issues);
  const fixable = issues.filter((i) => i.fix).length;
  const verdict = issues.length === 0 ? "No problems found" : score >= 90 ? "Looks good" : score >= 70 ? "A few things to check" : "Needs work";

  return (
    <section className="card mt-4 p-5" aria-labelledby="compat-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="compat-h" className="text-sm font-semibold">Compatibility check</h2>
          <p className="text-xs text-muted">Rule-based checks, not a real email-client test.</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-right" data-testid="compat-score">
            <span className="text-2xl font-semibold tabular-nums">{score}</span>
            <span className="text-xs text-muted"> / 100 · {verdict}</span>
          </p>
          {fixable > 1 && <button className="btn" onClick={onFixAll}>Fix all ({fixable})</button>}
        </div>
      </div>

      {issues.length === 0 ? (
        <p role="status" className="text-sm text-muted">Images, links, text and colours all look safe for email.</p>
      ) : (
        <ul className="divide-y divide-line">
          {issues.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${TONE[i.severity]}`}>{LABEL[i.severity]}</span>
              <p className="min-w-0 flex-1 text-sm">{i.message}</p>
              <span className="flex shrink-0 gap-2">
                {i.blockIndex !== undefined && (
                  <button className="min-h-11 px-2 text-sm font-medium text-accent" onClick={() => onSelect(i.blockIndex!)}>Show</button>
                )}
                {i.fix && <button className="btn" onClick={() => onFix(i)}>{i.fixLabel ?? "Fix"}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
