// No "use client": a snackbar always lives inside a client component that owns it and passes
// callbacks, so it joins that client bundle.
import { useEffect, useRef } from "react";
import { strings } from "../strings";
import { Icon, type IconComponent } from "./Icon";
import styles from "./Snackbar.module.css";

/** How long a snackbar stays (components.md: 8 s). */
export const SNACKBAR_DURATION_MS = 8000;

type SnackbarProps = {
  icon: IconComponent;
  message: string;
  onUndo?: () => void;
  onDismiss: () => void;
};

/**
 * Confirms a small action and offers Undo. It stays 8 s and pauses while hovered or focused.
 * Never shown during recording, and never the only place a status appears (frame H-rules);
 * callers enforce both. Values from frame E3.
 */
export function Snackbar({ icon, message, onUndo, onDismiss }: SnackbarProps) {
  const remainingRef = useRef(SNACKBAR_DURATION_MS);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(0);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const pause = () => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingRef.current -= Date.now() - startedRef.current;
  };

  const resume = () => {
    if (timerRef.current !== null) return;
    startedRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismissRef.current(), remainingRef.current);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: start the timer once per snackbar.
  useEffect(() => {
    resume();
    return pause;
  }, []);

  return (
    <div
      role="status"
      className={styles.snackbar}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <Icon icon={icon} size={20} />
      <span className={styles.message}>{message}</span>
      {onUndo ? (
        <button type="button" className={`btn btn-ghost ${styles.undo}`} onClick={onUndo}>
          {strings.common.undo}
        </button>
      ) : null}
    </div>
  );
}
