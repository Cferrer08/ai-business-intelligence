import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { CreateWorkspaceForm } from "@/components/app/CreateWorkspaceForm";
import { requireSession } from "@/lib/auth/session";
import { listWorkspaces } from "@/lib/server/workspace";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await requireSession();
  const { new: addingAnother } = await searchParams;
  const workspaces = await listWorkspaces(session.user.id);
  if (workspaces.length > 0 && !addingAnother) redirect("/dashboard");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5"><Wordmark href={workspaces.length ? "/dashboard" : "/"} /></header>
      <main className="flex flex-1 justify-center px-6 pt-8 sm:pt-16">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold tracking-tight">
            {addingAnother ? "Create another workspace" : `Set up your workspace, ${session.user.name.split(" ")[0]}`}
          </h1>
          <p className="mt-2 leading-relaxed text-ink-soft">
            A workspace holds your datasets, analyses and reports. Data in one workspace is never visible from another.
          </p>
          <div className="mt-8"><CreateWorkspaceForm /></div>
        </div>
      </main>
    </div>
  );
}
