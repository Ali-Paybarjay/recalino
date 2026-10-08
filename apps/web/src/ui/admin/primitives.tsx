import { cloneElement, isValidElement, type ReactNode, useId } from "react";
import styles from "./Admin.module.css";
import type { AdminLocale } from "./contracts";
import { statusName } from "./copy";

export function Panel({
  title,
  children,
  hero = false,
}: {
  title?: string;
  children: ReactNode;
  hero?: boolean;
}) {
  return (
    <section className={`${styles.panel} ${hero ? styles.hero : ""}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  danger = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  danger?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${styles.button} ${primary ? styles.primary : ""} ${danger ? styles.danger : ""}`}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  const id = useId();
  const control = isValidElement<{ id?: string; "aria-describedby"?: string }>(children)
    ? cloneElement(children, { id, "aria-describedby": help ? `${id}-help` : undefined })
    : children;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {control}
      {help && (
        <small id={`${id}-help`} className={styles.help}>
          {help}
        </small>
      )}
    </div>
  );
}
export function Notice({
  children,
  warning = false,
  error = false,
}: {
  children: ReactNode;
  warning?: boolean;
  error?: boolean;
}) {
  return (
    <div
      className={`${styles.notice} ${warning ? styles.warning : ""} ${error ? styles.error : ""}`}
    >
      {children}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}
export function Badge({ state, locale }: { state: string; locale: AdminLocale }) {
  const tone = /failed|bounced|expired/.test(state)
    ? styles.error
    : /unknown|pending|awaiting|needs/.test(state)
      ? styles.warning
      : "";
  return (
    <span className={`${styles.badge} ${tone}`} title={state}>
      {statusName(state, locale)}
    </span>
  );
}
export function Table({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll wide data tables (WCAG 2.1.1).
    <section className={styles.tableWrap} tabIndex={0} aria-label={columns.join(" · ")}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </section>
  );
}
