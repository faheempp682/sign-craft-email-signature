import { CardEditor } from "../card-editor";
import { loadCards, Unavailable } from "../load";
import { MAX_CARDS_PER_USER } from "@/lib/cards/schema";

export const metadata = { title: "New digital card · SignCraft" };
export const dynamic = "force-dynamic";

export default async function NewCardPage() {
  const data = await loadCards();
  if (data.kind !== "ok") return <Unavailable data={data} />;
  return <CardEditor origin={data.origin} cardCount={data.cards.length} limit={MAX_CARDS_PER_USER} />;
}
