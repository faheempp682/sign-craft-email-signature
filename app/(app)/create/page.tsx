import Link from "next/link";
import { getSignatureUsage } from "@/lib/signature-usage";
import { getPreset } from "@/lib/presets";
import { getBunnyConfig } from "@/lib/storage/bunny";
import { CreateStudio } from "./create-studio";

export const metadata = { title: "Choose a template · SignCraft" };
export const dynamic = "force-dynamic";

/** First screen for a new customer: pick a template. The AI route is a button, not the starting point. */
export default async function CreatePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const usage = await getSignatureUsage();
  if (usage?.full) {
    // Everything after this screen ends in a save that would be refused, so say so before they spend time on it.
    return (
      <div className="mx-auto max-w-xl py-10">
        <p className="eyebrow mb-2">New signature</p>
        <h1 className="text-3xl font-semibold tracking-tight">You have {usage.count} of {usage.limit} signatures.</h1>
        <p className="mt-3 text-muted">That is the most one account can keep. Delete a signature you no longer use, then come back to create a new one, or edit one you already have.</p>
        <Link href="/signatures" className="btn btn-primary mt-6 inline-flex">Manage my signatures</Link>
      </div>
    );
  }
  return (
    <CreateStudio
      initialId={t && getPreset(t) ? t : undefined}
      canUpload={!!getBunnyConfig()}
      header={
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h1 className="text-3xl font-semibold tracking-tight">Choose a template.</h1>
            <p className="mt-3 text-muted">Pick the look you like. It opens with a form on the right, and the signature updates as you add your details.</p>
            {usage && <p className="mt-2 text-sm text-muted">You have {usage.count} of {usage.limit} signatures saved.</p>}
          </div>
          <Link href="/create/customize" className="btn shrink-0">
            Customize template
          </Link>
        </header>
      }
    />
  );
}
