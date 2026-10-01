"use client";

import { deleteDataset } from "@/app/actions/datasets";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function DeleteDatasetButton({ datasetId, name }: { datasetId: string; name: string }) {
  return (
    <form
      action={deleteDataset}
      onSubmit={(e) => {
        if (!confirm(`Delete “${name}”? The file and its profile will be removed.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="datasetId" value={datasetId} />
      <SubmitButton pendingLabel="Deleting…" className="!bg-paper-raised !text-down border border-line hover:!bg-down/5">
        Delete dataset
      </SubmitButton>
    </form>
  );
}
