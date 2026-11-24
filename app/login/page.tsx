import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/supabase/auth-utils";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · SignCraft" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeNext(next);
  if (await getUser()) redirect(target);

  return (
    <main className="mx-auto grid min-h-screen max-w-sm content-center gap-6 px-4 py-12">
      <header>
        <p className="eyebrow mb-2">SignCraft</p>
        <h1 className="text-3xl font-semibold tracking-tight">Sign in to save your signatures.</h1>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">That link is invalid or has expired. Please sign in again.</p>}
      <LoginForm next={target} />
    </main>
  );
}
