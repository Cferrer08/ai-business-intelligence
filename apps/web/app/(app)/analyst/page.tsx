import type { Metadata } from "next";
import { Analyst } from "@/components/analyst/Analyst";
import { NotReady } from "@/components/analyst/NotReady";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { getDatasetProfile, listDatasets } from "@/lib/server/datasets";
import { aiConfigured } from "@/lib/server/ai";
import { suggestQuestions } from "@/lib/analyst/describe";

export const metadata: Metadata = { title: "AI Analyst" };

export default async function NewAnalysisPage() {
  const { workspace } = await requireWorkspace();
  if (!aiConfigured()) return <NotReady reason="no_key" />;
  const ready = (await listDatasets(workspace.id)).filter((d) => d.status === "ready");
  if (ready.length === 0) return <NotReady reason="no_dataset" />;
  const options = await Promise.all(
    ready.slice(0, 50).map(async (d) => {
      const p = await getDatasetProfile(workspace.id, d.id);
      return { id: d.id, name: d.name, suggestions: p ? suggestQuestions(p.profile) : [] };
    }),
  );
  return <Analyst datasets={options} initialTurns={[]} suggestions={[]} canAsk={roleAtLeast(workspace.role, "MEMBER")} />;
}
