import type { InputHTMLAttributes, ReactNode } from "react";
import { Check } from "../icons";
import styles from "./Checkbox.module.css";
import { Icon } from "./Icon";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & {
  label: ReactNode;
};

// A native checkbox; the whole row is the 44px hit area. Consent boxes are never pre-checked:
// callers pass no defaultChecked for them (components.md, HANDOFF §5).
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={[styles.row, className].filter(Boolean).join(" ")}>
      <input {...rest} type="checkbox" className={`${styles.input} rc-visually-hidden`} />
      <span className={styles.box} aria-hidden="true">
        <Icon icon={Check} weight="bold" size={14} className={styles.mark} />
      </span>
      <span>{label}</span>
    </label>
  );
}
