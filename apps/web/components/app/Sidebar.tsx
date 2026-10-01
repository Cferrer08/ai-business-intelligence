"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CURRENT_PHASE, NAV } from "./nav";

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-px">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const ready = item.phase <= CURRENT_PHASE;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center justify-between rounded-sm px-3 py-1.5 text-sm ${
              active ? "bg-paper-raised font-semibold text-ink shadow-[inset_3px_0_0_#1D5FBF]" : "text-ink-soft hover:bg-paper-raised/70 hover:text-ink"
            }`}
          >
            <span>{item.label}</span>
            {!ready ? <span className="text-xs text-ink-muted" title={`Arrives in phase ${item.phase}`}>soon</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
