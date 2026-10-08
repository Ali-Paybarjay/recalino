"use client";

import { useEffect, useState } from "react";
import styles from "./UploadProgress.module.css";

export function UploadProgress({
  label,
  status,
  value,
  detail,
  startedAt,
  finishedAt,
  active = true,
}: {
  label: string;
  status: string;
  value?: number;
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
  active?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active || startedAt === undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);
  const percent = value === undefined ? undefined : Math.max(0, Math.min(100, Math.floor(value)));
  const seconds =
    startedAt === undefined
      ? null
      : Math.max(0, Math.floor(((finishedAt ?? now) - startedAt) / 1000));
  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <span role="status">{status}</span>
        {percent === undefined ? null : (
          <span aria-hidden="true" className={styles.percentage}>
            {percent}%
          </span>
        )}
      </div>
      <progress aria-label={label} value={percent} max={100} className={styles.bar} />
      {detail || seconds !== null ? (
        <p className={styles.detail}>
          {detail}
          {detail && seconds !== null ? " · " : ""}
          {seconds !== null
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} elapsed`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
