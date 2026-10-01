export function qualityTone(score: number) {
  return score >= 90 ? "text-up" : score >= 70 ? "text-caution" : "text-down";
}

export function QualityBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-ink-muted">—</span>;
  return <span className={`num font-semibold ${qualityTone(score)}`}>{score}</span>;
}
