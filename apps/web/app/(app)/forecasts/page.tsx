import type { Metadata } from "next";
import { AdvancedPage } from "@/components/runs/AdvancedPage";

export const metadata: Metadata = { title: "Forecasts" };

export default function ForecastsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  return <AdvancedPage page="forecasts" title="Forecasts" searchParams={searchParams}
    description="Forecast a total ahead. Several methods are tested on your own history and the simplest one that predicts well is used." />;
}
