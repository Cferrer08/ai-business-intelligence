import { Wordmark } from "@/components/Wordmark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-5"><Wordmark /></header>
      <main className="flex flex-1 items-start justify-center px-6 pb-16 pt-8 sm:pt-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
