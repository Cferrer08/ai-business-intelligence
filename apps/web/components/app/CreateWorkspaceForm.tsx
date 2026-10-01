"use client";

import { useActionState } from "react";
import { createWorkspace, type WorkspaceState } from "@/app/actions/workspace";
import { Field } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function CreateWorkspaceForm({ submitLabel = "Create workspace" }: { submitLabel?: string }) {
  const [state, action] = useActionState<WorkspaceState, FormData>(createWorkspace, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const values = state && !state.ok ? state.values ?? {} : {};
  return (
    <form action={action} className="space-y-5" noValidate key={JSON.stringify(values)}>
      <FormError message={state && !state.ok && !state.fieldErrors ? state.error : undefined} />
      <Field label="Workspace name" name="name" defaultValue={values.name} placeholder="Northside Retail" required hint="Usually your company or team name. You can change it later." error={errors.name} />
      <SubmitButton pendingLabel="Creating…">{submitLabel}</SubmitButton>
    </form>
  );
}
