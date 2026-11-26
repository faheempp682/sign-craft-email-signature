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
    <main className="min-h-screen bg-surface p-[14px]">
      <div className="grid min-h-[calc(100vh-28px)] lg:grid-cols-2">
        <section
          className="relative hidden flex-col justify-between overflow-hidden rounded-[28px] p-12 text-white lg:flex"
          style={{
            background:
              "radial-gradient(55% 40% at 30% 28%, rgba(221,179,163,0.38) 0%, rgba(221,179,163,0) 70%), radial-gradient(60% 45% at 78% 62%, rgba(197,143,122,0.30) 0%, rgba(197,143,122,0) 70%), linear-gradient(150deg, #2a3446 0%, #171e2b 50%, #0c1019 100%)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/sig-craft-email-signatures-logo-white.png" alt="SignCraft" className="h-14 w-auto self-start object-contain" />
          <div className="space-y-4">
            <span className="inline-block rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur">Craft signatures that get noticed ✨</span>
            <h2 className="text-5xl font-medium leading-[1.05] tracking-tight">Start your Journey</h2>
            <p className="text-white/85">Follow these simple steps to set up your account.</p>
            <ol className="grid grid-cols-3 gap-3 pt-4">
              {STEPS.map((s) => (
                <li key={s.n} className={`login-tile flex h-56 flex-col overflow-hidden rounded-2xl border p-3 text-sm ${s.n === 1 ? "border-[#ddb3a3]/60" : "border-white/10"}`}>
                  <div aria-hidden="true" className="relative flex-1">
                    {s.n === 1 && (
                      <>
                        <span className="lt-glow absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-[#ddb3a3]/60 bg-[#ddb3a3]/15 px-4 py-1.5 text-xs font-medium text-[#f3e2db]">Sign in</span>
                        {[{ l: "62%", t: "62%", d: "0s" }, { l: "78%", t: "50%", d: "0.5s" }, { l: "70%", t: "78%", d: "1s" }].map((c) => (
                          <svg key={c.d} viewBox="0 0 16 16" width="14" height="14" className="lt-cursor absolute fill-[#ddb3a3]" style={{ left: c.l, top: c.t, animationDelay: c.d }}>
                            <path d="M2 1l12 6-5 1.5L7 14z" />
                          </svg>
                        ))}
                      </>
                    )}
                    {s.n === 2 && (
                      <>
                        {[{ x: "22%", h: 34, d: "0s", i: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" }, { x: "50%", h: 62, d: "0.8s", i: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4" }, { x: "78%", h: 28, d: "1.6s", i: "M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 003-3c0-5-4-11-8-11z" }].map((b) => (
                          <div key={b.x} className="lt-bob absolute top-0 -translate-x-1/2" style={{ left: b.x, animationDelay: b.d }}>
                            <span className="mx-auto block w-px bg-white/25" style={{ height: b.h }} />
                            <span className="grid size-9 place-items-center rounded-full border border-white/20 bg-white/10 text-[#ddb3a3]">
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d={b.i} /></svg>
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                    {s.n === 3 && (
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="lt-ripple absolute inset-0 rounded-2xl border border-[#ddb3a3]/50" style={{ animationDelay: `${i}s` }} />
                        ))}
                        <div className="relative flex h-16 w-12 flex-col justify-center gap-1.5 rounded-2xl border border-[#ddb3a3]/70 bg-[#ddb3a3]/15 px-2.5">
                          {[0, 1, 2, 3].map((i) => (
                            <span key={i} className="lt-line block h-0.5 w-full rounded-full bg-[#ddb3a3]" style={{ animationDelay: `${i * 0.25}s` }} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-end gap-2">
                    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${s.n === 1 ? "bg-[#ddb3a3] text-[#171e2b]" : "border border-white/50 text-white"}`}>{s.n}</span>
                    <span className="text-xs leading-snug text-white/85">{s.label}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="flex flex-col justify-center gap-6 px-5 py-10 sm:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-sm space-y-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sig-craft-email-signatures-logo-dark.png" alt="SignCraft" className="mx-auto h-12 w-auto object-contain dark:hidden lg:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sig-craft-email-signatures-logo-white.png" alt="SignCraft" className="mx-auto hidden h-12 w-auto object-contain dark:block dark:lg:hidden" />
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
