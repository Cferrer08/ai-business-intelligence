"use client";

import { useActionState } from "react";
import { login, type AuthState } from "@/app/actions/auth";
import { Field } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<AuthState, FormData>(login, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const values = state && !state.ok ? state.values ?? {} : {};
  return (
    <form action={action} className="space-y-5" noValidate key={JSON.stringify(values)}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormError message={state && !state.ok && !state.fieldErrors ? state.error : undefined} />
      <Field label="Email" name="email" defaultValue={values.email} type="email" autoComplete="email" required error={errors.email} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required error={errors.password} />
      <SubmitButton pendingLabel="Signing in…" className="w-full">Sign in</SubmitButton>
    </form>
  );
}
