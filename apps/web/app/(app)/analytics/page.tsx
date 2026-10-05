import type { Metadata } from "next";
import { AdvancedPage } from "@/components/runs/AdvancedPage";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage({ searchParams }: { searchParams: Promise<{ run?: string; tab?: string }> }) {
  return <AdvancedPage page="analytics" title="Analytics" searchParams={searchParams}
    description="Relationships between measures, customer segments, and whether a measure is really trending." />;
}
