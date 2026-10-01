import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SignupForm } from "@/components/auth/SignupForm";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-2 text-ink-soft">Free to start. No card required.</p>
      <div className="mt-8"><SignupForm /></div>
      <p className="mt-6 text-sm text-ink-soft">
        Already have an account? <Link href="/login" className="font-semibold text-signal hover:underline">Sign in</Link>
      </p>
    </>
  );
}
