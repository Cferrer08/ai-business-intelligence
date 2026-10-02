import { Wordmark } from "@/components/Wordmark";

export function SchemaOutdated({ applied, expected }: { applied: number; expected: number }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <Wordmark />
      <h1 className="mt-10 text-2xl font-bold tracking-tight">The database needs updating</h1>
      <p className="mt-3 leading-relaxed text-ink-soft">
        This version of InsightAI expects {expected} database migrations, and {applied} {applied === 1 ? "has" : "have"} been applied.
        Run this in the project folder, then refresh the page:
      </p>
      <pre className="mt-4 overflow-x-auto rounded bg-ink px-4 py-3 text-sm text-white">npm run db:migrate</pre>
      <p className="mt-4 text-sm text-ink-muted">No data is lost. Migrations only add what the new version needs.</p>
    </main>
  );
}
