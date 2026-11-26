import type { Block, Column, RowBlock } from "@/lib/schema/document";

/**
 * Rows & columns -> nested, Outlook-safe tables. No flexbox, grid, floats or JavaScript.
 * Columns are <td> cells sharing one <tr>; the gap between them is its own fixed-width cell.
 * Mobile stacking uses a media query in a <style> block. Clients that drop <style> (and Outlook desktop, which ignores
 * media queries) simply keep the columns side by side, so the design must read correctly unstacked too.
 */

const TABLE = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

export const STACK_BREAKPOINT = 480;

/** Emitted once, ahead of the signature, only when the document has a stacking row. */
export const STACK_CSS = `<style type="text/css">@media only screen and (max-width:${STACK_BREAKPOINT}px){.sc-col{display:block!important;width:100%!important;max-width:100%!important;padding-left:0!important;padding-right:0!important}.sc-col.sc-pad{padding-left:24px!important;padding-right:24px!important}.sc-gap{display:none!important}.sc-row{width:100%!important}}</style>`;

/** Marks a column that stacks on mobile. The exporter adds STACK_CSS only when its output contains this. */
export const STACK_MARK = `class="sc-col"`;

/** Column widths as whole percents. Sized columns keep theirs; the rest split what is left equally. */
export function columnWidths(columns: readonly Column[]): number[] {
  const sized = columns.reduce((n, c) => n + (c.width ?? 0), 0);
  const free = columns.filter((c) => c.width === undefined).length;
  const share = free ? Math.max(0, 100 - sized) / free : 0;
  return columns.map((c) => c.width ?? Math.floor(share * 100) / 100);
}

function renderColumn(c: Column, width: number, renderChild: (b: Block) => string, gap: number, stack: boolean): string {
  const rows = c.blocks
    .map(renderChild)
    .filter(Boolean)
    .map((h, i) => `<tr><td style="padding-top:${i === 0 ? 0 : gap}px;">${h}</td></tr>`)
    .join("");
  const inner = rows ? `<table ${TABLE} width="100%">${rows}</table>` : "";
  const css: string[] = [`width:${width}%`];
  if (c.align) css.push(`text-align:${c.align}`);
  if (c.bg) css.push(`background-color:${c.bg}`);
  for (const [side, edge] of [["top", c.borderTop], ["right", c.borderRight], ["bottom", c.borderBottom], ["left", c.borderLeft]] as const) {
    if (edge) css.push(`border-${side}:${edge.width}px solid ${edge.color}`);
  }
  const pad = [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft];
  if (pad.some((p) => p)) css.push(`padding:${pad.map((p) => `${p ?? 0}px`).join(" ")}`);
  const attrs = [stack ? STACK_MARK : "", `width="${width}%"`, `valign="${c.valign ?? "top"}"`, c.align ? `align="${c.align}"` : "", c.bg ? `bgcolor="${c.bg}"` : ""].filter(Boolean).join(" ");
  return `<td ${attrs} style="${css.join(";")};">${inner}</td>`;
}

/**
 * One row. `renderChild` renders a nested block (and nested rows) the way the active template does, so every
 * existing block works inside a column. `blockGap` is the vertical rhythm between blocks in a column.
 */
export function renderRow(b: RowBlock, renderChild: (b: Block) => string, blockGap: number): string {
  if (b.hidden) return "";
  const widths = columnWidths(b.columns);
  const gap = b.gap ?? 0;
  const stack = b.stack !== false;
  const cells = b.columns
    .map((c, i) => {
      const spacer = i && gap ? `<td${stack ? ` class="sc-gap"` : ""} width="${gap}" style="width:${gap}px;font-size:1px;line-height:1px;">&nbsp;</td>` : "";
      return spacer + renderColumn(c, widths[i], renderChild, blockGap, stack);
    })
    .join("");
  if (!b.columns.some((c) => c.blocks.length)) return "";
  return `<table ${TABLE} width="100%" class="sc-row"><tr>${cells}</tr></table>`;
}
