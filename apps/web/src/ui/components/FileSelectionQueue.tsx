"use client";

import type { SelectedFile } from "../workspace/file-selection";
import { Actions, Button, Panel, Status } from "../workspace/primitives";
import styles from "./FileSelectionQueue.module.css";

export function FileSelectionQueue({
  files,
  busy,
  disabled = false,
  remove,
  submit,
  label = "Upload & Process",
  description,
  uploadHelp = true,
}: {
  files: SelectedFile[];
  busy: boolean;
  disabled?: boolean;
  remove: (id: string) => void;
  submit: () => void;
  label?: string;
  description?: string;
  uploadHelp?: boolean;
}) {
  if (!files.length) return null;
  const invalid = files.some((entry) => entry.invalid);
  return (
    <Panel title="Files to upload">
      <p className="workspace-muted">
        {description ?? "Choose Upload & Process to add these files to your session."}
      </p>
      <ul className="workspace-list" aria-label="Files to upload">
        {files.map(({ id, file, problem }) => (
          <li key={id}>
            <div className="workspace-row">
              <div className={styles.file}>
                <strong dir="auto">{file.name}</strong>
                <p className="workspace-muted">
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
          {files.length} {files.length === 1 ? "file to upload" : "files to upload"}
        </p>
        <Actions>
          <Button disabled={busy || disabled || invalid} onClick={submit}>
            {busy ? "Uploading…" : label}
          </Button>
        </Actions>
      </div>
      {invalid && (
        <p className="workspace-muted">
          Remove or replace the files marked above before uploading.
        </p>
      )}
      {uploadHelp && (
        <details className={styles.help}>
          <summary>About background uploads</summary>
          <p className="workspace-muted">
            Upload &amp; Process saves these files on this device so you can use other pages while
            they upload. If your browser pauses, uploads resume when you return. Files you have not
            submitted need to be selected again after leaving or reloading.
          </p>
        </details>
      )}
    </Panel>
  );
}
