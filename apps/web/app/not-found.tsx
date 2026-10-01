import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-ink-soft">The link may be wrong, or the page was moved.</p>
      <Link href="/dashboard" className="mt-6 inline-block font-semibold text-signal hover:underline">Go to dashboard</Link>
    </main>
  );
}
