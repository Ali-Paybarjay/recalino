import type { IconWeight } from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import { CircleNotch } from "../icons";
import { Icon, type IconComponent } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

// The look comes from the design classes (.btn, .btn-primary…) in nocturne-base.css and
// tokens.css; danger, lg and block are added in app.css (components.md).
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-secondary rc-btn-danger",
};

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: "md" | "lg";
  icon?: IconComponent;
  iconWeight?: IconWeight;
  /** Shows a spinner and sets aria-busy. The caller passes the loading text, e.g. "Saving…". */
  loading?: boolean;
  /** Full width. */
  block?: boolean;
  /**
   * Unavailable but still focusable, so it can say why: pair it with aria-describedby that
   * points at the reason (A1, A2.7). Use `disabled` only when no reason needs to be heard.
   */
  unavailable?: boolean;
};

export function buttonClassName(
  variant: ButtonVariant,
  size: "md" | "lg" = "md",
  extra?: string,
): string {
  return ["btn", VARIANT_CLASS[variant], size === "lg" && "rc-btn-lg", extra]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconWeight,
  loading = false,
  block = false,
  unavailable = false,
  className,
  children,
  onClick,
  type = "button",
  ...rest
}: ButtonProps) {
  // A blocked button drops its handler and never submits a form. No function is attached, so
  // the component also renders in server components.
  const blocked = unavailable || loading;
  return (
    <button
      {...rest}
      type={blocked ? "button" : type}
      className={buttonClassName(
        variant,
        size,
        [block && "rc-btn-block", className].filter(Boolean).join(" "),
      )}
      aria-busy={loading || undefined}
      aria-disabled={unavailable || undefined}
      onClick={blocked ? undefined : onClick}
    >
      {loading ? (
        <Icon icon={CircleNotch} className="rc-spin" />
      ) : icon ? (
        <Icon icon={icon} weight={iconWeight} />
      ) : null}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<ComponentProps<"button">, "children"> & {
  icon: IconComponent;
  /** Required: an icon-only button is named by this label (accessibility.md). */
  label: string;
  variant?: Exclude<ButtonVariant, "danger">;
  iconSize?: number;
};

export function IconButton({
  icon,
  label,
  variant = "ghost",
  iconSize = 20,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      className={buttonClassName(variant, "md", ["btn-icon", className].filter(Boolean).join(" "))}
    >
      <Icon icon={icon} size={iconSize} />
    </button>
  );
}
