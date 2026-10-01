"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="px-6 py-16 lg:px-10">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold">This page couldn&apos;t load.</h1>
        <p className="mt-2 text-ink-soft">Your data was not modified. The error has been logged.</p>
        <button onClick={reset} className="mt-6 rounded bg-signal px-4 py-2 text-sm font-semibold text-white hover:bg-signal-hover">Try again</button>
      </div>
    </div>
  );
}
