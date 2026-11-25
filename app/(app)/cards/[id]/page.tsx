import { notFound } from "next/navigation";
import { CardEditor } from "../card-editor";
import { loadCards, Unavailable } from "../load";
import { MAX_CARDS_PER_USER } from "@/lib/cards/schema";

export const metadata = { title: "Edit digital card · SignCraft" };
export const dynamic = "force-dynamic";

export default async function EditCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadCards();
  if (data.kind !== "ok") return <Unavailable data={data} />;
  const card = data.cards.find((c) => c.id === id);
  if (!card) notFound();
  return <CardEditor key={card.id} card={card} origin={data.origin} cardCount={data.cards.length} limit={MAX_CARDS_PER_USER} />;
}
