"use client";
import Link from "next/link";
import type { ReactNode } from "react";

export { Actions, Button, Field, Panel, Status } from "../preview/primitives";

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
