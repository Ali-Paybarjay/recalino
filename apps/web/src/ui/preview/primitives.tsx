"use client";
import Link from "next/link";
import {
  type ButtonHTMLAttributes,
  cloneElement,
  isValidElement,
  type ReactNode,
  useId,
} from "react";
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
  children,
  tone = "plain",
}: {
  title?: string;
  children: ReactNode;
  tone?: "hero" | "plain";
}) {
  return (
    <section className={`preview-panel ${tone === "hero" ? "preview-hero" : ""}`}>
      {title ? <h2>{title}</h2> : null}
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
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return (
    <button
      type={type}
      className={`btn ${secondary ? "btn-secondary" : "btn-primary"} rc-btn-lg ${className}`}
      {...props}
    />
  );
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
