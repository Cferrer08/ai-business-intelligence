import Link from "next/link";

// The mark is a tiny bar series ending in a raised bar: data, then the answer.
export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-ink">
      <svg width="20" height="18" viewBox="0 0 20 18" aria-hidden>
        <rect x="0" y="10" width="3" height="8" fill="#6B7685" />
        <rect x="5" y="7" width="3" height="11" fill="#6B7685" />
        <rect x="10" y="12" width="3" height="6" fill="#6B7685" />
        <rect x="15" y="2" width="3" height="16" fill="#1D5FBF" />
      </svg>
      <span className="text-base font-bold tracking-tight">InsightAI</span>
    </Link>
  );
}
