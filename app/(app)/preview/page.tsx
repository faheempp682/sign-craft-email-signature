import { TEMPLATE_IDS, type TemplateId } from "@/lib/schema/document";
import { Exporter } from "./exporter";

export const metadata = { title: "Exporter · SignCraft" };

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const initial = (TEMPLATE_IDS as readonly string[]).includes(t ?? "") ? (t as TemplateId) : "classic";
  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Exporter</p>
        <h1 className="text-3xl font-semibold tracking-tight">Copy it into your email client.</h1>
        <p className="mt-3 max-w-xl text-muted">Paste into Gmail, Outlook or Apple Mail, or download the .htm for Outlook desktop.</p>
      </header>
      <Exporter initial={initial} />
    </>
  );
}
