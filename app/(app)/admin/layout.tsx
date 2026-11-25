import { notFound } from "next/navigation";
import { currentRole } from "@/lib/authz/guard";

export const dynamic = "force-dynamic";

/**
 * Everything under /admin is admin-only. Anyone else gets a 404, so the area does not even advertise itself.
 * The sections are in the sidebar (platform-only ones appear only for platform admins; the pages and APIs enforce that too).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if ((await currentRole()) !== "admin") notFound();
  return <div>{children}</div>;
}
