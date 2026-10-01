import type { ReactNode } from "react";
import styles from "./SegmentedControl.module.css";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

type SegmentedControlProps<T extends string> = {
  /** Groups the native radios; arrow keys move between them. */
  name: string;
  label: string;
  options: readonly SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  size?: "md" | "sm";
};

// role="radiogroup" built from native radios (components.md). Values from frame D5.
export function SegmentedControl<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
  size = "md",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={[styles.group, size === "sm" && styles.small].filter(Boolean).join(" ")}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className={`${styles.input} rc-visually-hidden`}
          />
          {option.icon}
          {option.label}
        </label>
      ))}
    </div>
  );
}
