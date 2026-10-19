"use client";
import Link from "next/link";
import { type ComponentProps, cloneElement, isValidElement, type ReactNode, useId } from "react";
import { buttonClassName } from "../components/Button";
export function previewHref(to: string) {
  return to.startsWith("/") ? to : `/preview/${to}`;
}
export function PageHeader({
  title,
  description,
  back,
}: {
  title: string;
  description?: string;
  back?: string;
}) {
  return (
    <header className="preview-header">
      {back ? (
        <Link className="preview-back" href={previewHref(back)}>
          ← Back
        </Link>
      ) : null}
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  );
}
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
  to,
  children,
  secondary = false,
}: {
  to: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link
      href={previewHref(to)}
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
