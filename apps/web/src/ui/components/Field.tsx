import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { WarningCircle } from "../icons";
import styles from "./Field.module.css";
import { Icon } from "./Icon";

/** Props a field hands to its control, so label, hint and error are announced with it. */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

type FieldProps = {
  /** Stable id of the control; the hint and error ids derive from it. */
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (control: FieldControlProps) => ReactNode;
};

// Label always visible; error below with an icon, linked by aria-describedby (components.md).
export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${styles.field}`} data-invalid={error ? "" : undefined}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <div id={errorId} className={styles.error}>
          <Icon icon={WarningCircle} />
          {error}
        </div>
      ) : null}
      {hint ? (
        <div id={hintId} className={styles.hint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

/** Content input: direction follows what the learner types unless set (FR-PLT-011). */
export function TextInput({ className, dir = "auto", type = "text", ...rest }: TextInputProps) {
  return (
    <input
      {...rest}
      type={type}
      dir={dir}
      className={["input", className].filter(Boolean).join(" ")}
    />
  );
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ className, dir = "auto", ...rest }: TextAreaProps) {
  return (
    <textarea {...rest} dir={dir} className={["input", className].filter(Boolean).join(" ")} />
  );
}
