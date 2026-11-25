import { redirect } from "next/navigation";
import { getPreset } from "@/lib/presets";
import { DetailsForm } from "./details-form";

export const metadata = { title: "Your details · SignCraft" };

export default async function DetailsPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const preset = t ? getPreset(t) : undefined;
  if (!preset) redirect("/create"); // no or unknown template: back to the list
  return <DetailsForm templateId={preset.id} templateName={preset.name} />;
}
