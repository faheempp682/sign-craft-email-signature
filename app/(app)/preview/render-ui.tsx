import { CLIENTS, type ClientId } from "@/lib/preview-clients";

/** "Real engine" is a solid pill, "Simulation" a dashed outline, "Approximation" a plain outline. The words carry the meaning, not the colour. */
export function KindPill({ kind }: { kind: "real" | "simulation" | "approximation"; }) {
  const text = kind === "real" ? "Real engine" : kind === "simulation" ? "Simulation" : "Approximation in Chrome";
  const style =
    kind === "real"
      ? "bg-accent text-accent-ink"
      : kind === "simulation"
        ? "border border-dashed border-ink text-ink"
        : "border border-line text-muted";
  return <span data-kind={kind} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{text}</span>;
}

/** Badge and one-line explanation for a client's in-page preview. */
export function ClientBadge({ client }: { client: ClientId }) {
  const c = CLIENTS[client];
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-xs text-muted" data-testid="client-badge">
      <KindPill kind={c.fidelity} />
      <span>{c.note}</span>
    </p>
  );
}
