import type { IconWeight, Icon as PhosphorIcon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";

export type IconComponent = PhosphorIcon;

type IconProps = {
  icon: PhosphorIcon;
  /** Defaults to 1em, like the icon font in the design frames: the icon follows the font size. */
  size?: number | string;
  weight?: IconWeight;
  className?: string;
  style?: CSSProperties;
};

/** A decorative icon. The text next to it carries the meaning (HANDOFF §3: icon + text). */
export function Icon({
  icon: Glyph,
  size = "1em",
  weight = "regular",
  className,
  style,
}: IconProps) {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={size}
      weight={weight}
      className={className}
      style={style}
    />
  );
}
