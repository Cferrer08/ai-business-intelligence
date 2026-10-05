import type { Metadata } from "next";
import { AdvancedPage } from "@/components/runs/AdvancedPage";

export const metadata: Metadata = { title: "Anomalies" };

export default function AnomaliesPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  return <AdvancedPage page="anomalies" title="Anomalies" searchParams={searchParams}
    description="Find unusual days, unusual transactions, or groups that suddenly changed. Every flag says why." />;
}
