import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/supabase/auth-utils";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · SignCraft" };

const STEPS = [
  { n: 1, label: "Sign in or create your account" },
  { n: 2, label: "Design your email signature" },
  { n: 3, label: "Save and share it with your team" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeNext(next);
  if (await getUser()) redirect(target);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-3 sm:p-6">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-[32px] border border-line bg-surface p-2 shadow-[var(--shadow-card)] lg:min-h-[640px] lg:grid-cols-2">
        <section
          className="relative hidden flex-col justify-between overflow-hidden rounded-[26px] p-8 text-white lg:flex"
          style={{
            background:
              "radial-gradient(60% 45% at 35% 30%, #8cc8ff 0%, rgba(140,200,255,0) 70%), radial-gradient(70% 50% at 70% 55%, #55ccff 0%, rgba(85,204,255,0) 70%), linear-gradient(160deg, #2a46b8 0%, #3f8cf0 40%, #4fb8ff 62%, #1d2a9a 100%)",
          }}
        >
          <p className="text-xl font-semibold tracking-tight">SignCraft</p>
          <div className="space-y-4">
            <span className="inline-block rounded-full bg-white/20 px-4 py-2 text-sm backdrop-blur">Craft signatures that get noticed ✨</span>
            <h2 className="text-5xl font-medium leading-[1.05] tracking-tight">Start your Journey</h2>
            <p className="text-white/85">Follow these simple steps to set up your account.</p>
            <ol className="grid grid-cols-3 gap-3 pt-4">
              {STEPS.map((s) => (
                <li
                  key={s.n}
                  className={`flex aspect-square flex-col justify-between rounded-2xl p-3 text-sm backdrop-blur ${
                    s.n === 1 ? "bg-white text-[#0f172a]" : "bg-white/20 text-white/80"
                  }`}
                >
                  <span
                    className={`flex size-7 items-center justify-center rounded-full text-xs ${
                      s.n === 1 ? "bg-[#1d3fd1] text-white" : "border border-white/50"
                    }`}
                  >
                    {s.n}
                  </span>
                  <span className="leading-snug">{s.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="flex flex-col justify-center gap-6 px-5 py-10 sm:px-12">
          <div className="mx-auto w-full max-w-sm space-y-6">
            <h1 className="text-center text-4xl font-medium tracking-tight">
              Join <span className="text-brand">SignCraft</span>
            </h1>
            {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">That link is invalid or has expired. Please sign in again.</p>}
            <LoginForm next={target} />
          </div>
        </section>
      </div>
    </main>
  );
}
