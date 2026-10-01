import type { ElementType, ReactNode } from "react";
import { directionOf } from "../direction";
import styles from "./ContentBlock.module.css";

type ContentBlockProps = {
  /** BCP 47 code of the content, so the OS picks the right script face (FR-PLT-011). */
  lang?: string;
  /**
   * Stored block direction when known. Without it, the direction of `lang` is used, and with no
   * language the first strong letter decides (dir="auto").
   */
  dir?: "ltr" | "rtl" | "auto";
  /** Notes reading size: 17/1.65, a little taller for RTL and CJK (Design System §2). */
  reading?: boolean;
  as?: ElementType;
  className?: string;
  children: ReactNode;
};

// Each content block sets its own lang and dir inside the English, left-to-right UI
// (PRD-ONB-01, D31 rule 7). An RTL block aligns right; the UI around it does not change.
export function ContentBlock({
  lang,
  dir,
  reading = false,
  as: Tag = "div",
  className,
  children,
}: ContentBlockProps) {
  return (
    <Tag
      lang={lang}
      dir={dir ?? (lang ? directionOf(lang) : "auto")}
      className={[styles.block, reading && styles.reading, className].filter(Boolean).join(" ")}
    >
      {children}
    </Tag>
  );
}

type BdiProps = {
  lang?: string;
  children: ReactNode;
};

/** Isolates an inline run in another direction, so punctuation around it stays in place. */
export function Bdi({ lang, children }: BdiProps) {
  return <bdi lang={lang}>{children}</bdi>;
}
