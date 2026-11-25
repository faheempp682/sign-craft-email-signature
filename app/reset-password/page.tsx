import { ResetPasswordForm } from "./reset-form";

export const metadata = { title: "Set your password · SignCraft" };

/** Landing page of the invitation / reset email. The link's token is in the URL hash, so the form reads the session in the browser. */
export default function ResetPasswordPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-sm content-center gap-6 px-4 py-12">
      <header>
        <p className="eyebrow mb-2">SignCraft</p>
        <h1 className="text-3xl font-semibold tracking-tight">Set your password</h1>
      </header>
      <ResetPasswordForm />
    </main>
  );
}
