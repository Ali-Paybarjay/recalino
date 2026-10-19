"use client";
import Link from "next/link";
import { type ComponentProps, cloneElement, isValidElement, type ReactNode, useId } from "react";
import { buttonClassName } from "../components/Button";

// Shared layout primitives of the learner workspace (audit QUA-08). The /preview fixtures import
// them from here and keep their own preview-only links (preview-links.tsx). The class names still
// carry the historical `preview-` prefix (workspace.css); renaming them is a recorded follow-up
// in docs/design/UI_TOKEN_FOLLOWUPS_2026-10-19.md.
export function Panel({
  title,
  info,
  children,
  tone = "plain",
}: {
  title?: string;
  /** Shown after the title, outside the heading, e.g. an InfoTip. */
  info?: ReactNode;
  children: ReactNode;
  tone?: "hero" | "plain";
}) {
  return (
    <section className={`preview-panel ${tone === "hero" ? "preview-hero" : ""}`}>
      {title && info ? (
        <div className="preview-panel-title">
          <h2>{title}</h2>
          {info}
        </div>
      ) : title ? (
        <h2>{title}</h2>
      ) : null}
      {children}
    </section>
  );
}
export function Actions({ children }: { children: ReactNode }) {
  return <div className="preview-actions">{children}</div>;
}
export function LinkButton({
  href,
  children,
  secondary = false,
  disabled = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Link
      prefetch={false}
      href={href}
      aria-disabled={disabled || undefined}
      onClick={disabled ? (event) => event.preventDefault() : undefined}
      className={`btn ${secondary ? "btn-secondary" : "btn-primary"} rc-btn-lg`}
    >
      {children}
    </Link>
  );
}
export function Button({
  secondary = false,
  danger = false,
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { secondary?: boolean; danger?: boolean }) {
  // UI-05: a button that confirms a deletion never looks like a primary action (components.md).
  const variant = danger ? "danger" : secondary ? "secondary" : "primary";
  return <button type={type} className={buttonClassName(variant, "lg", className)} {...props} />;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const control = isValidElement<{ id?: string; "aria-describedby"?: string }>(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        "aria-describedby": hint
          ? [children.props["aria-describedby"], `${id}-hint`].filter(Boolean).join(" ")
          : children.props["aria-describedby"],
      })
    : children;
  const controlId = isValidElement<{ id?: string }>(control) ? control.props.id : id;
  return (
    <div className="preview-field">
      <label htmlFor={controlId}>{label}</label>
      {control}
      {hint ? (
        <p id={`${id}-hint`} className="preview-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
export function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "error";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`preview-status preview-status-${tone}`}
    >
      {children}
    </p>
  );
}
