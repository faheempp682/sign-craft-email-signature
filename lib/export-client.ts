/** Browser-side export helpers shared by the exporter and the editor. */

export async function copyHtmlRich(html: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([html.replace(/<[^>]+>/g, " ")], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function downloadHtm(html: string, filename: string): void {
  const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
