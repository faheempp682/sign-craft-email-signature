"use client";

import { useMemo } from "react";
import { scoresOf, type Issue, type IssueCategory, type Severity } from "@/lib/linter";
import { checkDarkMode, darkVariant } from "@/lib/dark";
import type { SignatureDoc } from "@/lib/schema/document";

const LABEL: Record<Severity, string> = { error: "Fix", warning: "Check", info: "Tip" };
const TONE: Record<Severity, string> = {
  error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  info: "bg-surface-2 text-muted",
};

const SECTIONS: { cat: IssueCategory; title: string; clean: string }[] = [
  { cat: "compat", title: "Compatibility", clean: "Images, links and layout look safe for email." },
  { cat: "accessibility", title: "Accessibility", clean: "Alt text, sizes, links and colour contrast look good." },
  { cat: "gif", title: "Animated GIF", clean: "No problems found with the animated image." },
  { cat: "dark", title: "Dark mode", clean: "Colours should stay readable on a dark background." },
];

const verdictOf = (n: number, count: number) => (count === 0 ? "No problems found" : n >= 90 ? "Looks good" : n >= 70 ? "A few things to check" : "Needs work");

function ScoreChip({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <li className="rounded-lg border border-line px-3 py-1.5" data-testid={testId}>
      <span className="text-xs text-muted">{label} </span>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted"> / 100</span>
    </li>
  );
}

function IssueRow({ i, onFix, onSelect }: { i: Issue; onFix: (i: Issue) => void; onSelect: (b: number) => void }) {
  const hasActions = i.blockIndex !== undefined || !!i.fix;
  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid="issue-row">
      {/* The message always gets the full width beside the badge, whatever the panel width; buttons sit underneath. */}
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 w-14 shrink-0 rounded-md px-2 py-0.5 text-center text-xs font-semibold ${TONE[i.severity]}`}>{LABEL[i.severity]}</span>
        <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{i.message}</p>
      </div>
      {hasActions && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-[4.25rem] max-[380px]:pl-0" data-testid="issue-actions">
          {i.blockIndex !== undefined && (
            <button className="min-h-11 px-2 text-sm font-medium text-accent" onClick={() => onSelect(i.blockIndex!)}>Show</button>
          )}
          {i.fix && <button className="btn max-w-full whitespace-normal text-left [overflow-wrap:anywhere]" onClick={() => onFix(i)}>{i.fixLabel ?? "Fix"}</button>}
        </div>
      )}
    </li>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block size-4 shrink-0 rounded border border-line align-middle" style={{ background: color }} />;
}

/** Light and dark contrast for each theme colour, in words as well as marks so it does not rely on colour alone. */
function DarkCheck({ doc }: { doc: SignatureDoc }) {
  const report = useMemo(() => checkDarkMode(doc), [doc]);
  const variant = useMemo(() => darkVariant(doc), [doc]);
  return (
    <div className="mb-3 rounded-lg border border-line p-3" data-testid="dark-check">
      <p className="mb-2 text-xs text-muted">
        {report.plain
          ? "This design has no background of its own, so it sits on the reader's page: white in light mode, dark in dark mode."
          : "This design paints its own background, so its colours meet the same surface in both modes."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Contrast of each colour on light and dark backgrounds</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1 pr-3 font-medium">Colour</th>
              <th scope="col" className="py-1 pr-3 font-medium">{report.plain ? "On light" : "On the card"}</th>
              <th scope="col" className="py-1 font-medium">{report.plain ? "On dark" : "In dark mode"}</th>
            </tr>
          </thead>
          <tbody>
            {report.roles.map((r) => (
              <tr key={r.role} className="border-t border-line">
                <th scope="row" className="py-1.5 pr-3 font-normal">
                  <Swatch color={r.color} /> {r.label} <span className="text-xs text-muted">{r.color}</span>
                </th>
                <td className="py-1.5 pr-3 tabular-nums">{r.lightRatio.toFixed(1)}:1 {r.lightOk ? "Pass" : "Fail"}</td>
                <td className="py-1.5 tabular-nums">{r.darkRatio.toFixed(1)}:1 {r.darkOk ? "Pass" : "Fail"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-accent">
          Dark variant: {variant.changes.length === 0 ? "no changes needed" : `${variant.changes.length} colour${variant.changes.length === 1 ? "" : "s"} would change`}
        </summary>
        {variant.changes.length > 0 && (
          <ul className="space-y-2 pt-1 text-sm">
            {variant.changes.map((c) => (
              <li key={c.field}>
                <Swatch color={c.from} /> {c.from} <span aria-hidden="true">→</span><span className="sr-only">to</span> <Swatch color={c.to} /> {c.to}
                <span className="block text-xs text-muted">{c.field.replace("theme.", "")}: {c.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
      <p className="mt-2 text-xs text-muted">
        Email apps handle dark mode differently: some keep your colours, some invert them, some recolour them. This check covers the colours you control and does not replace sending a test to real apps.
      </p>
    </div>
  );
}

export function CompatPanel({
  issues,
  onFix,
  onFixAll,
  onSelect,
  doc,
}: {
  issues: Issue[];
  onFix: (issue: Issue) => void;
  onFixAll: () => void;
  onSelect: (blockIndex: number) => void;
  /** Optional: when given, the dark-mode section shows the colour check and dark variant. */
  doc?: SignatureDoc;
}) {
  const scores = scoresOf(issues);
  // "Fix all" skips opt-in fixes (dark mode trade-offs); each of those has its own button.
  const fixable = issues.filter((i) => i.fix && !i.optIn).length;
  const verdict = verdictOf(scores.overall, issues.length);
  const byCat = (cat: IssueCategory) => issues.filter((i) => i.category === cat);
  const showGif = byCat("gif").length > 0;

  return (
    <section className="card mt-4 p-5" aria-labelledby="compat-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="compat-h" className="text-sm font-semibold">Compatibility, accessibility and dark mode</h2>
          <p className="text-xs text-muted">Rule-based checks, not a real email-client test.</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-right" data-testid="compat-score">
            <span className="text-2xl font-semibold tabular-nums">{scores.overall}</span>
            <span className="text-xs text-muted"> / 100 · {verdict}</span>
          </p>
          {fixable > 1 && <button className="btn" onClick={onFixAll}>Fix all ({fixable})</button>}
        </div>
      </div>

      <ul className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Scores by category">
        <ScoreChip label="Compatibility" value={scores.compat} testId="score-compat" />
        <ScoreChip label="Accessibility" value={scores.accessibility} testId="score-accessibility" />
        <ScoreChip label="Dark mode" value={scores.dark} testId="score-dark" />
      </ul>

      {issues.length === 0 && !doc && <p role="status" className="text-sm text-muted">Images, links, text and colours all look safe for email.</p>}

      {SECTIONS.filter((s) => s.cat !== "gif" || showGif).map((s) => {
        const list = byCat(s.cat);
        return (
          <div key={s.cat} className="mb-4 last:mb-0" data-testid={`section-${s.cat}`}>
            <h3 className="mb-2 text-sm font-semibold">
              {s.title} <span className="font-normal text-muted">({list.length === 0 ? "no issues" : `${list.length} to look at`})</span>
            </h3>
            {s.cat === "dark" && doc && <DarkCheck doc={doc} />}
            {list.length === 0 ? (
              <p role="status" className="text-sm text-muted">{s.clean}</p>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((i) => <IssueRow key={i.id} i={i} onFix={onFix} onSelect={onSelect} />)}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
