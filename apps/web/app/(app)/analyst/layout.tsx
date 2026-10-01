import { History } from "@/components/analyst/History";
import { requireWorkspace } from "@/lib/server/workspace";
import { listConversations } from "@/lib/server/analyst";

export default async function AnalystLayout({ children }: { children: React.ReactNode }) {
  const { workspace } = await requireWorkspace();
  const items = await listConversations(workspace.id);
  return (
    <div className="lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-line px-3 py-4 lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">AI Analyst</p>
        <History items={items.map((i) => ({ ...i, updatedAt: i.updatedAt.toISOString() }))} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
