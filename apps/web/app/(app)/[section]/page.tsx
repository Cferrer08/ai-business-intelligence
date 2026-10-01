import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/PageHeader";
import { UPCOMING } from "@/components/app/nav";

// Sections that aren't built yet. Each states plainly what it will do and when,
// rather than showing sample data that could be mistaken for real results.
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const item = UPCOMING[(await params).section];
  return { title: item?.label ?? "Not found" };
}

export default async function UpcomingSection({ params }: { params: Promise<{ section: string }> }) {
  const item = UPCOMING[(await params).section];
  if (!item) notFound();
  return (
    <>
      <PageHeader title={item.label} />
      <div className="px-6 py-10 lg:px-10">
        <div className="max-w-xl rounded-lg border border-dashed border-line px-6 py-8">
          <p className="font-semibold">Not built yet: arrives in phase {item.phase}</p>
          <p className="mt-2 leading-relaxed text-ink-soft">{item.summary}</p>
        </div>
      </div>
    </>
  );
}
