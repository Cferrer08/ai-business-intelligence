"use client";

import { useState, useTransition } from "react";
import { shareReport, unshareReport } from "@/app/actions/reports";

export function ShareControls({ reportId, shared }: { reportId: string; shared: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" disabled={pending} onClick={() => start(async () => {
        const r = await shareReport(reportId);
        if (r.ok) { setUrl(r.data.url); setError(null); } else setError(r.error);
      })} className="rounded border border-line bg-paper-raised px-3 py-1.5 hover:border-signal">
        {shared || url ? "Create a new share link" : "Share link"}
      </button>
      {shared || url ? (
        <form action={unshareReport}>
          <input type="hidden" name="reportId" value={reportId} />
          <button type="submit" className="rounded border border-line bg-paper-raised px-3 py-1.5 text-down hover:bg-down/5">Turn off sharing</button>
        </form>
      ) : null}
      {url ? (
        <span className="flex w-full items-center gap-2">
          <input readOnly value={url} aria-label="Share link" className="min-w-0 flex-1 rounded border border-line bg-paper px-2 py-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={async () => { await navigator.clipboard?.writeText(url).catch(() => {}); setCopied(true); }} className="rounded border border-line px-2 py-1 text-xs">{copied ? "Copied" : "Copy"}</button>
        </span>
      ) : shared ? <span className="w-full text-xs text-ink-muted">Sharing is on. Links can only be shown once; create a new link to copy it again (the old one stops working).</span> : null}
      {error ? <span role="alert" className="text-down">{error}</span> : null}
    </div>
  );
}
