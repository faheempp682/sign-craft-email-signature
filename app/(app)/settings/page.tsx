import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { SettingsForms } from "./settings-forms";

export const metadata = { title: "Account settings · SignCraft" };

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/settings");

  const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  // Accounts created through a sign-in provider have no password of their own to verify.
  const hasPassword = (user.app_metadata?.providers as string[] | undefined)?.includes("email") ?? true;

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Account settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your name, sign-in email and password.</p>
      </header>
      <SettingsForms email={user.email ?? ""} name={name} hasPassword={hasPassword} />
    </div>
  );
}
