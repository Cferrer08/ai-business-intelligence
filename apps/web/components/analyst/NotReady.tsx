import Link from "next/link";

export function NotReady({ reason }: { reason: "no_key" | "no_dataset" }) {
  return (
    <div className="px-6 py-10 lg:px-10">
      <div className="max-w-xl rounded-lg border border-line bg-paper-raised px-6 py-5">
        {reason === "no_key" ? (
          <>
            <p className="font-semibold">The AI analyst needs an OpenAI API key</p>
            <p className="mt-2 text-ink-soft">Add <code className="rounded bg-paper-sunk px-1">OPENAI_API_KEY=…</code> to <code className="rounded bg-paper-sunk px-1">apps/web/.env.local</code>, then restart the app.</p>
          </>
        ) : (
          <>
            <p className="font-semibold">Upload a dataset first</p>
            <p className="mt-2 text-ink-soft">The analyst answers questions about a dataset in this workspace.</p>
            <Link href="/data" className="mt-4 inline-block text-sm font-semibold text-signal hover:underline">Go to Data</Link>
          </>
        )}
      </div>
    </div>
  );
}
