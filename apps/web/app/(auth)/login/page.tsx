import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSession()) redirect("/dashboard");
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-ink-soft">Welcome back. Your workspaces are where you left them.</p>
      <div className="mt-8"><LoginForm next={next} /></div>
      <p className="mt-6 text-sm text-ink-soft">
        New to InsightAI? <Link href="/signup" className="font-semibold text-signal hover:underline">Create an account</Link>
      </p>
    </>
  );
}
