"use client";

import { useActionState } from "react";
import { signup, type AuthState } from "@/app/actions/auth";
import { Field } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function SignupForm() {
  const [state, action] = useActionState<AuthState, FormData>(signup, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const values = state && !state.ok ? state.values ?? {} : {};
  return (
    <form action={action} className="space-y-5" noValidate key={JSON.stringify(values)}>
      <FormError message={state && !state.ok && !state.fieldErrors ? state.error : undefined} />
      <Field label="Your name" name="name" defaultValue={values.name} autoComplete="name" required error={errors.name} />
      <Field label="Work email" name="email" defaultValue={values.email} type="email" autoComplete="email" required error={errors.email} />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters." error={errors.password} />
      <SubmitButton pendingLabel="Creating account…" className="w-full">Create account</SubmitButton>
    </form>
  );
}
