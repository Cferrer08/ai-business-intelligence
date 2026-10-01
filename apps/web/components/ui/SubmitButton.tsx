"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingLabel, className = "" }: { children: React.ReactNode; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center rounded bg-signal px-4 py-2.5 text-sm font-semibold text-white hover:bg-signal-hover disabled:cursor-wait disabled:opacity-70 ${className}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
