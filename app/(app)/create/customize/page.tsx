import Link from "next/link";
import { ArrowLeftIcon } from "@solar-icons/react/linear/arrow-left";
import { AiChat } from "./ai-chat";

export const metadata = { title: "Create with AI · SignCraft" };

export default function CustomizePage() {
  return (
    <div className="wide-page">
      <Link href="/create" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeftIcon size={16} /> Back to templates
      </Link>
      <AiChat />
    </div>
  );
}
