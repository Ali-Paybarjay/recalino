"use client";

import { UploadProgress } from "../components/UploadProgress";
import styles from "./AutomaticLearningView.module.css";
import type { learningProgress } from "./learning-progress";

type Progress = ReturnType<typeof learningProgress>;

export function LearningProgress({
  progress,
  compact = false,
  paused = false,
  pausedLabel = "Check status",
}: {
  progress: Progress;
  compact?: boolean;
  paused?: boolean;
  pausedLabel?: string;
}) {
  const current = progress.steps.findIndex(
    (step) => step.state === "current" || step.state === "blocked",
  );
  return (
    <div className={styles.progress}>
      <div className={styles.segments} aria-hidden="true">
        {progress.steps.map((step) => (
          <span key={step.id} data-state={step.state} data-active={progress.active && !paused} />
        ))}
      </div>
      {progress.upload ? (
        <UploadProgress
          label="Material upload progress"
          status={
            paused
              ? pausedLabel
              : progress.preparing
                ? "Checking files before upload…"
                : "Upload progress"
          }
          value={progress.upload.percent ?? undefined}
          detail={
            progress.preparing
              ? "Upload starts automatically when this check finishes."
              : `${formatBytes(progress.upload.sentBytes)} of ${formatBytes(progress.upload.totalBytes)} transferred`
          }
          active={progress.active && !paused}
        />
      ) : progress.active && !paused ? (
        <UploadProgress
          label="Current stage progress"
          status={
            progress.stage === "process"
              ? "Processing your material…"
              : progress.stage === "verify"
                ? "Checking uploaded files…"
                : "Preparing your upload…"
          }
          detail={
            progress.stage === "process"
              ? "This stage updates automatically as processing finishes."
              : undefined
          }
        />
      ) : null}
      {compact ? (
        <p className={styles.stageLabel}>
          {current >= 0
            ? `Step ${current + 1} of ${progress.steps.length} · ${progress.steps[current]?.label}`
            : progress.steps.every((step) => step.state === "complete")
              ? "All steps complete"
              : "Ready when you add material"}
        </p>
      ) : (
        <ol className={styles.timeline} aria-label="Session processing steps">
          {progress.steps.map((step, index) => (
            <li
              key={step.id}
              data-state={step.state}
              aria-current={
                step.state === "current" || step.state === "blocked" ? "step" : undefined
              }
            >
              <span className={styles.stepMarker} aria-hidden="true">
                {step.state === "complete" ? "✓" : step.state === "blocked" ? "!" : index + 1}
              </span>
              <span>
                <strong>{step.label}</strong>
                <span className={styles.stepState}>
                  {step.state === "complete"
                    ? "Complete"
                    : step.state === "blocked"
                      ? "Needs attention"
                      : step.state === "current"
                        ? paused
                          ? pausedLabel
                          : progress.active
                            ? "In progress"
                            : "Next step"
                        : "Waiting"}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {!compact && progress.upload?.files.length ? (
        <ul className={styles.files} aria-label="File upload progress">
          {progress.upload.files.map((file) => (
            <li key={file.id}>
              <strong dir="auto">{file.displayName}</strong>
              <UploadProgress
                label={`Upload progress for ${file.displayName}`}
                status={paused ? pausedLabel : file.label}
                value={file.percent ?? undefined}
                detail={
                  file.preparing
                    ? "Checking this file on your device…"
                    : `${formatBytes(file.sentBytes)} of ${formatBytes(file.totalBytes)}`
                }
                active={progress.active && !paused}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
