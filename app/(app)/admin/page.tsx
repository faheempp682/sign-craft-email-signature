import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/authz/guard";

export const dynamic = "force-dynamic";

/** Platform admins start at the feature switches; admins of other organizations start at their own organization's screens. */
export default async function AdminIndex() {
  redirect((await isPlatformAdmin()) ? "/admin/features" : "/admin/campaigns");
}
