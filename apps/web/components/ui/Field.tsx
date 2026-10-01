import type { InputHTMLAttributes } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
  hint?: string;
}

export function Field({ label, name, error, hint, ...input }: FieldProps) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-ink">{label}</label>
      <input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={`block w-full rounded border bg-paper-raised px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/25 ${error ? "border-down" : "border-line"}`}
        {...input}
      />
      {error ? (
        <p id={`${name}-error`} className="text-sm text-down">{error}</p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-sm text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
