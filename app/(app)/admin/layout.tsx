import { notFound } from "next/navigation";
import { currentRole } from "@/lib/authz/guard";
import { AdminTabs } from "./admin-tabs";

export const dynamic = "force-dynamic";

/** Everything under /admin is admin-only. Anyone else gets a 404, so the area does not even advertise itself. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if ((await currentRole()) !== "admin") notFound();
  return (
    <>
      <header className="mb-8">
        <p className="eyebrow mb-2">Admin</p>
        <h1 className="text-3xl font-semibold tracking-tight">Access control</h1>
        <p className="mt-3 max-w-2xl text-muted">Decide who can use which features, how much AI each role gets, and who is an admin. Changes apply on the next request.</p>
      </header>
      <AdminTabs />
      <div className="mt-8">{children}</div>
    </>
  );
}
