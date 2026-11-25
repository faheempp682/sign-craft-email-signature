import Link from "next/link";
import { AiChat } from "./ai-chat";

export const metadata = { title: "Create with AI · SignCraft" };

export default function CustomizePage() {
  return (
    <>
      <Link href="/create" className="mb-2 inline-block text-sm text-muted hover:text-ink">&larr; Back to templates</Link>
      <AiChat />
    </>
  );
}
