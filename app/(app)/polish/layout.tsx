import { atLeast } from "@/lib/authz/roles";
import { currentRole } from "@/lib/authz/guard";
import { PolishTabs } from "./polish-tabs";

export const dynamic = "force-dynamic";

export default async function PolishLayout({ children }: { children: React.ReactNode }) {
  const role = await currentRole();
  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Designer polish</p>
        <h1 className="text-3xl font-semibold tracking-tight">AI draft, SignCraft designer polish.</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Send a saved signature to a SignCraft designer with a note. They work on a copy, you compare the two side by side, and nothing changes in your library until you say so.
        </p>
      </header>
      <PolishTabs isDesigner={role !== null && atLeast(role, "designer")} />
      <div className="mt-8">{children}</div>
    </>
  );
}
