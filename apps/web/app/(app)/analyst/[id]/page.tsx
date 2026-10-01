import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Analyst } from "@/components/analyst/Analyst";
import { requireWorkspace, roleAtLeast } from "@/lib/server/workspace";
import { getConversation, getTurns } from "@/lib/server/analyst";
import { getDatasetProfile } from "@/lib/server/datasets";
import { aiConfigured } from "@/lib/server/ai";
import { suggestQuestions } from "@/lib/analyst/describe";

export const metadata: Metadata = { title: "AI Analyst" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireWorkspace();
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const conv = await getConversation(workspace.id, id.data);
  if (!conv) notFound();
  const [turns, profile] = await Promise.all([getTurns(workspace.id, id.data), getDatasetProfile(workspace.id, conv.dataset.id)]);
  const datasetGone = Boolean(conv.dataset.deletedAt) || conv.dataset.status !== "ready";
  return (
    <Analyst
      key={id.data}
      conversationId={id.data}
      datasetName={conv.dataset.name + (datasetGone ? " (deleted)" : "")}
      datasets={[]}
      initialTurns={turns}
      suggestions={profile && !datasetGone ? suggestQuestions(profile.profile).filter((s) => s !== "Summarize this dataset").slice(0, 3) : []}
      canAsk={roleAtLeast(workspace.role, "MEMBER") && aiConfigured() && !datasetGone}
    />
  );
}
