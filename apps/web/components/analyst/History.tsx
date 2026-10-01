"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function History({ items }: { items: { id: string; title: string; datasetName: string; updatedAt: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Analysis history" className="space-y-px">
      <Link href="/analyst" className={`mb-3 block rounded px-3 py-2 text-sm font-semibold ${path === "/analyst" ? "bg-signal text-white" : "border border-line bg-paper-raised text-ink hover:border-signal"}`}>
        New analysis
      </Link>
      {items.length === 0 ? <p className="px-3 text-sm text-ink-muted">No analyses yet.</p> : null}
      {items.map((c) => (
        <Link key={c.id} href={`/analyst/${c.id}`} aria-current={path === `/analyst/${c.id}` ? "page" : undefined}
          className={`block rounded-sm px-3 py-2 ${path === `/analyst/${c.id}` ? "bg-paper-raised shadow-[inset_3px_0_0_#1D5FBF]" : "hover:bg-paper-raised/70"}`}>
          <span className="line-clamp-2 text-sm text-ink">{c.title}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">{c.datasetName}</span>
        </Link>
      ))}
    </nav>
  );
}
