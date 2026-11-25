import { CardsList } from "./cards-list";
import { loadCards, Unavailable } from "./load";
import { MAX_CARDS_PER_USER } from "@/lib/cards/schema";

export const metadata = { title: "Digital cards · SignCraft" };
export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const data = await loadCards();
  if (data.kind !== "ok") return <Unavailable data={data} />;
  return <CardsList cards={data.cards} origin={data.origin} limit={MAX_CARDS_PER_USER} />;
}
