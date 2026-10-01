"use client";

import { useActionState } from "react";
import { renameWorkspace, type WorkspaceState } from "@/app/actions/workspace";
import { Field } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function RenameWorkspaceForm({ workspaceId, name, canEdit }: { workspaceId: string; name: string; canEdit: boolean }) {
  const [state, action] = useActionState<WorkspaceState, FormData>(renameWorkspace, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="max-w-md space-y-4" noValidate>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <FormError message={state && !state.ok && !state.fieldErrors ? state.error : undefined} />
      <Field label="Workspace name" name="name" defaultValue={state && !state.ok ? state.values?.name ?? name : name} disabled={!canEdit} error={errors.name} hint={canEdit ? undefined : "Only owners and admins can rename this workspace."} />
      {canEdit ? (
        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Saving…">Save name</SubmitButton>
          {state?.ok ? <span role="status" className="text-sm text-up">Saved</span> : null}
        </div>
      ) : null}
    </form>
  );
}
