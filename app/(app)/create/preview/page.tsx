import { redirect } from "next/navigation";
import { getPreset } from "@/lib/presets";
import { PreviewStep } from "./preview-step";

export const metadata = { title: "Your signature · SignCraft" };

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  if (!t || !getPreset(t)) redirect("/create");
  return <PreviewStep initialId={t} />;
}
