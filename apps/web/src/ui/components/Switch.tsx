// No "use client": useId also works in server components, and a switch always gets its
// onChange from a client component.
import { useId } from "react";
import styles from "./Switch.module.css";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

// role="switch", 48 × 28 (components.md; frames C1 and E1). The visible label is a <label>,
// so clicking it toggles the switch and names it.
export function Switch({ checked, onChange, label, disabled = false, className }: SwitchProps) {
  const id = useId();
  return (
    <span className={[styles.row, className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={styles.track}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} />
      </button>
    </span>
  );
}
