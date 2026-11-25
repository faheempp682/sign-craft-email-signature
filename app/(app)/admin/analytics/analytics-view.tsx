import type { CampaignTotals } from "@/lib/campaigns/stats";

const pct = (r: number | null) => (r === null ? "n/a" : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);
const num = (n: number) => n.toLocaleString("en-US");

/** Clicks per day as plain SVG bars. The same numbers are in the table below, so the chart is a summary, not the only source. */
export function DayChart({ days, name }: { days: { day: string; clicks: number }[]; name: string }) {
  const W = 600;
  const H = 150;
  const pad = { l: 28, r: 4, t: 8, b: 22 };
  const max = Math.max(1, ...days.map((d) => d.clicks));
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const bw = (W - pad.l - pad.r) / Math.max(days.length, 1);
  const total = days.reduce((n, d) => n + d.clicks, 0);
  const every = Math.ceil(days.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name}: ${total} clicks over ${days.length} days`} className="h-auto w-full" preserveAspectRatio="xMidYMid meet">
      {[0, 0.5, 1].map((t) => {
        const y = pad.t + (H - pad.t - pad.b) * (1 - t);
        return (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={pad.l - 4} y={y + 4} textAnchor="end" fontSize="13" fill="var(--muted)">{Math.round(niceMax * t)}</text>
          </g>
        );
      })}
      {days.map((d, i) => {
        const h = (d.clicks / niceMax) * (H - pad.t - pad.b);
        const x = pad.l + i * bw;
        return (
          <g key={d.day}>
            <rect x={x + bw * 0.12} y={H - pad.b - h} width={Math.max(bw * 0.76, 1)} height={h} rx="1.5" fill="var(--accent)">
              <title>{`${d.day}: ${d.clicks} clicks`}</title>
            </rect>
            {i % every === 0 && (
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="13" fill="var(--muted)">{d.day.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function AnalyticsView({ totals, from, to, rangeError }: { totals: CampaignTotals[]; from: string; to: string; rangeError: string }) {
  const csv = `/api/campaigns/analytics?from=${from}&to=${to}&format=csv`;
  return (
    <div className="space-y-10">
      <form method="get" className="card flex flex-wrap items-end gap-3 p-4 sm:p-6" aria-label="Date range">
        <div>
          <label htmlFor="from" className="mb-1 block text-sm text-muted">From</label>
          <input id="from" name="from" type="date" defaultValue={from} className="field min-h-11" required />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-sm text-muted">To</label>
          <input id="to" name="to" type="date" defaultValue={to} className="field min-h-11" required />
        </div>
        <button type="submit" className="btn btn-primary min-h-11">Show</button>
        <a href={csv} className="btn inline-flex min-h-11 items-center" download>Download CSV</a>
        {rangeError && <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">{rangeError} Showing the last 30 days instead.</p>}
      </form>

      <p className="max-w-2xl text-sm text-muted">
        <strong className="text-ink">Clicks are the number to trust.</strong> Image loads are not views: mail apps such as Apple Mail fetch images in advance and some proxies cache them, so they overcount. Clicks per image load is a rough guide, not a true click-through rate. Unique clicks count each anonymous visitor once per day; nothing identifies a person.
      </p>

      {totals.length === 0 && <p className="text-sm text-muted">No campaigns yet.</p>}
      {totals.map((c) => (
        <section key={c.campaignId} aria-labelledby={`a-${c.campaignId}`} className="card divide-y divide-line">
          <header className="px-4 py-3 sm:px-6">
            <h2 id={`a-${c.campaignId}`} className="font-semibold">{c.name}</h2>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-muted">Clicks</dt><dd className="text-xl font-semibold tabular-nums">{num(c.clicks)}</dd></div>
              <div><dt className="text-muted">Unique clicks (per day)</dt><dd className="text-xl font-semibold tabular-nums">{num(c.uniqueClicks)}</dd></div>
              <div><dt className="text-muted">Image loads</dt><dd className="text-xl font-semibold tabular-nums">{num(c.imageLoads)}</dd></div>
              <div><dt className="text-muted">Clicks per image load</dt><dd className="text-xl font-semibold tabular-nums">{pct(c.ctr)}</dd></div>
            </dl>
          </header>
          <div className="px-4 py-4 sm:px-6">
            <h3 className="mb-2 text-sm font-medium text-muted">Clicks per day</h3>
            <DayChart days={c.days} name={c.name} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <caption className="sr-only">{c.name}: results per variant</caption>
              <thead className="border-b border-line text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium sm:px-6">Variant</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Clicks</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Unique</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Image loads</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium sm:px-6">Clicks per load</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {c.variants.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-3 text-muted sm:px-6">No variants yet.</td></tr>
                )}
                {c.variants.map((v) => (
                  <tr key={v.variantId ?? "fallback"}>
                    <th scope="row" className="px-4 py-2 font-normal sm:px-6">{v.label}</th>
                    <td className="px-2 py-2 text-right tabular-nums">{num(v.clicks)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(v.uniqueClicks)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(v.imageLoads)}</td>
                    <td className="px-4 py-2 text-right tabular-nums sm:px-6">{pct(v.ctr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
