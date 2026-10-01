import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { AnalysisTrace } from "@/components/marketing/AnalysisTrace";
import { getSession } from "@/lib/auth/session";

export default async function LandingPage() {
  const session = await getSession();
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-5 text-sm">
          {session ? (
            <Link href="/dashboard" className="font-semibold text-signal hover:underline">Open dashboard</Link>
          ) : (
            <>
              <Link href="/login" className="text-ink-soft hover:text-ink">Sign in</Link>
              <Link href="/signup" className="rounded bg-ink px-3.5 py-2 font-semibold text-white hover:bg-ink-soft">Analyze your data</Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
        <div className="max-w-xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ textWrap: "balance" }}>
            Your AI data analyst, always available.
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-ink-soft">
            Upload your business data, ask questions in plain English, and get answers calculated from your actual numbers, with charts, forecasts and the next steps worth taking.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link href={session ? "/dashboard" : "/signup"} className="rounded bg-signal px-5 py-3 text-sm font-semibold text-white hover:bg-signal-hover">
              Analyze your data
            </Link>
            <a href="#how" className="px-1 py-3 text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
              See how it works
            </a>
          </div>
        </div>
        <AnalysisTrace />
      </main>

      <section id="how" className="border-t border-line bg-paper-raised">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-3">
          {[
            ["Upload a file", "CSV, Excel, JSON or Parquet. Every dataset gets a quality check: missing values, duplicates, outliers and column types."],
            ["Ask a question", "\u201cWhich region is underperforming?\u201d The analyst plans the analysis and runs it in a Python engine on your real rows."],
            ["Act on the answer", "Each result separates calculated facts from interpretation, and ends with what to investigate next."],
          ].map(([title, body], i) => (
            <div key={title}>
              <p className="num text-sm font-semibold text-signal">Step {i + 1}</p>
              <h2 className="mt-2 text-lg font-semibold">{title}</h2>
              <p className="mt-2 max-w-sm leading-relaxed text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-8 text-sm text-ink-muted">© {new Date().getFullYear()} InsightAI</footer>
    </div>
  );
}
