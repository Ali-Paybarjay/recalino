"use client";

import { Actions, Button, Panel, Status } from "../preview/primitives";
import type { SelectedFile } from "../workspace/file-selection";
import styles from "./FileSelectionQueue.module.css";

export function FileSelectionQueue({
  files,
  busy,
  disabled = false,
  remove,
  submit,
  label = "Upload & Process",
  description,
}: {
  files: SelectedFile[];
  busy: boolean;
  disabled?: boolean;
  remove: (id: string) => void;
  submit: () => void;
  label?: string;
  description?: string;
}) {
  const invalid = files.some((entry) => entry.invalid);
  return (
    <Panel title="Files ready to upload">
      <p className="preview-muted">
        {description ??
          "Add files one at a time or select several together. When your list is ready, choose Upload & Process to send them all."}
      </p>
      <ul className="preview-list" aria-label="Selected files">
        {files.map(({ id, file, problem }) => (
          <li key={id}>
            <div className="preview-row">
              <div className={styles.file}>
                <strong dir="auto">{file.name}</strong>
                <p className="preview-muted">
                  {(file.size / 1_000_000).toFixed(2)} MB · Waiting to upload
                </p>
              </div>
              <Button
                secondary
                disabled={busy}
                onClick={() => remove(id)}
                aria-label={`Remove selected file: ${file.name}`}
              >
                Remove
              </Button>
            </div>
            {problem && <Status tone="error">{problem}</Status>}
          </li>
        ))}
      </ul>
      <div className={styles.summary}>
        <p role="status">
          {files.length} {files.length === 1 ? "file selected" : "files selected"}
        </p>
        <Actions>
          <Button disabled={busy || disabled || invalid || !files.length} onClick={submit}>
            {busy ? "Uploading…" : label}
          </Button>
        </Actions>
      </div>
      {invalid && (
        <p className="preview-muted">Remove or replace the files marked above before uploading.</p>
      )}
      <p className="preview-muted">
        Choose Upload &amp; Process to save these files on this device. You can then use other pages
        while they upload. If your browser pauses, upload resumes when you return. Files that have
        not been submitted still need to be selected again after leaving or reloading.
      </p>
    </Panel>
  );
}
