import type { WorkspaceSummary } from "@insight/types";
import { switchWorkspace } from "@/app/actions/workspace";

export function WorkspaceSwitcher({ current, workspaces }: { current: WorkspaceSummary; workspaces: WorkspaceSummary[] }) {
  if (workspaces.length < 2) {
    return <p className="truncate px-3 text-sm font-semibold text-ink" title={current.name}>{current.name}</p>;
  }
  return (
    <details className="group relative px-1">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-sm px-2 py-1.5 text-sm font-semibold text-ink hover:bg-paper-raised/70">
        <span className="truncate">{current.name}</span>
        <span aria-hidden className="text-ink-muted group-open:rotate-180">▾</span>
      </summary>
      <ul className="absolute left-1 right-1 z-20 mt-1 rounded border border-line bg-paper-raised py-1 shadow-lg">
        {workspaces.map((w) => (
          <li key={w.id}>
            <form action={switchWorkspace}>
              <input type="hidden" name="workspaceId" value={w.id} />
              <button type="submit" className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-paper ${w.id === current.id ? "font-semibold text-signal" : "text-ink"}`}>
                {w.name}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}
