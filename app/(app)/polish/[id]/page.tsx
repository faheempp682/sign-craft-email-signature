import { notFound } from "next/navigation";
import { IdParam } from "@/lib/polish/schemas";
import { RequestDetail } from "../request-detail";

export const metadata = { title: "Polish request · SignCraft" };
export const dynamic = "force-dynamic";

export default async function PolishRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const id = IdParam.safeParse((await params).id);
  if (!id.success) notFound();
  return <RequestDetail id={id.data} />;
}
