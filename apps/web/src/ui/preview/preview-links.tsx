"use client";
import Link from "next/link";
import type { ReactNode } from "react";

// Navigation used only by the /preview fixtures (D35): relative targets resolve under /preview.
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
    <header className="workspace-header">
      {back ? (
        <Link className="workspace-back" href={previewHref(back)}>
          ← Back
        </Link>
      ) : null}
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  );
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
