export const metadata = { title: "Card not found", robots: { index: false, follow: false } };

/** The same page for a card that does not exist and one that is not published. */
export default function CardNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-2xl font-semibold">Card not found</h1>
        <p className="mt-2 text-muted">This digital card does not exist or is not available.</p>
      </div>
    </main>
  );
}
