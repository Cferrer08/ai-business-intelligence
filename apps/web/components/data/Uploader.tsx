"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCEPT_ATTRIBUTE, checkUpload, MAX_UPLOAD_MB } from "@/lib/datasets/rules";

type State =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; percent: number }
  | { kind: "processing"; name: string }
  | { kind: "error"; message: string };

export interface UploaderConfig {
  endpoint: string;
  accept: string;
  check: (f: { name: string; size: number }) => string | null;
  hint: string;
  redirect: (id: string) => string;
  processingText: string;
  label: string;
}

const DATASETS: UploaderConfig = {
  endpoint: "/api/datasets", accept: ACCEPT_ATTRIBUTE, check: checkUpload,
  hint: `CSV, Excel (.xlsx), JSON or Parquet, up to ${MAX_UPLOAD_MB} MB.`, redirect: (id) => `/data/${id}`,
  processingText: "Checking the file and profiling every column…", label: "Upload a dataset",
};

export function Uploader({ disabled, config = DATASETS }: { disabled?: boolean; config?: UploaderConfig }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const busy = state.kind === "uploading" || state.kind === "processing";

  function send(file: File) {
    const problem = config.check(file);
    if (problem) return setState({ kind: "error", message: problem });

    const body = new FormData();
    body.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", config.endpoint);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const percent = Math.round((e.loaded / e.total) * 100);
      setState(percent >= 100 ? { kind: "processing", name: file.name } : { kind: "uploading", name: file.name, percent });
    };
    xhr.upload.onload = () => setState({ kind: "processing", name: file.name });
    xhr.onload = () => {
      const res = xhr.response as { ok?: boolean; id?: string; error?: string } | null;
      if (xhr.status === 200 && res?.ok && res.id) {
        router.push(config.redirect(res.id));
        return;
      }
      if (xhr.status === 401) return router.push("/login");
      setState({ kind: "error", message: res?.error ?? "The upload failed. Try again." });
      router.refresh();
    };
    xhr.onerror = () => setState({ kind: "error", message: "The connection dropped during the upload. Try again." });
    setState({ kind: "uploading", name: file.name, percent: 0 });
    xhr.send(body);
  }

  function onFiles(files: FileList | null) {
    if (files && files[0]) send(files[0]);
    if (input.current) input.current.value = "";
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy && !disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy && !disabled) onFiles(e.dataTransfer.files); }}
        className={`flex flex-col items-start gap-4 rounded-lg border border-dashed px-6 py-6 sm:flex-row sm:items-center sm:justify-between ${
          dragging ? "border-signal bg-signal-tint/60" : "border-line bg-paper-raised"
        }`}
      >
        {state.kind === "uploading" || state.kind === "processing" ? (
          <div className="w-full" role="status" aria-live="polite">
            <p className="font-medium">{state.name}</p>
            <p className="mt-0.5 text-sm text-ink-soft">
              {state.kind === "uploading" ? `Uploading… ${state.percent}%` : config.processingText}
            </p>
            <div className="mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-paper-sunk">
              <div
                className={`h-1.5 rounded-full bg-signal ${state.kind === "processing" ? "w-full animate-pulse" : ""}`}
                style={state.kind === "uploading" ? { width: `${state.percent}%` } : undefined}
              />
            </div>
          </div>
        ) : (
          <>
            <div>
              <p className="font-medium">Drop a file here, or choose one</p>
              <p className="mt-0.5 text-sm text-ink-soft">{config.hint}</p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => input.current?.click()}
              className="shrink-0 rounded bg-signal px-4 py-2.5 text-sm font-semibold text-white hover:bg-signal-hover disabled:opacity-60"
            >
              Choose file
            </button>
          </>
        )}
        <input ref={input} type="file" accept={config.accept} className="sr-only" tabIndex={-1} aria-label={config.label} onChange={(e) => onFiles(e.target.files)} />
      </div>
      {state.kind === "error" ? (
        <p role="alert" className="mt-3 rounded border border-down/30 bg-down/5 px-3 py-2 text-sm text-down">{state.message}</p>
      ) : null}
    </div>
  );
}
