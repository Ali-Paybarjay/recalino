import type { CSSProperties, ReactNode } from "react";
import { ArrowClockwise, WarningCircle } from "../icons";
import { shellStrings as strings } from "../strings-shell";
import { Button } from "./Button";
import styles from "./Feedback.module.css";
import { Icon, type IconComponent } from "./Icon";

export type BannerTone = "info" | "primary" | "warning" | "success" | "danger" | "neutral";

type BannerProps = {
  tone: BannerTone;
  icon: IconComponent;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  /** "alert" only for real failures (accessibility.md); everything else is a polite status. */
  role?: "status" | "alert";
  /** "strip": full-width page banner under the status bar (frame H-offline). */
  layout?: "box" | "strip";
};

// Page-wide state: partial result, experimental language, offline, new sources, updated Terms
// (frame H-rules). Values from the Design System banners and frame H-offline.
export function Banner({
  tone,
  icon,
  title,
  children,
  action,
  role = "status",
  layout = "box",
}: BannerProps) {
  return (
    <div role={role} className={[styles.banner, styles[layout], styles[tone]].join(" ")}>
      <Icon icon={icon} className={styles.bannerIcon} />
      <div className={styles.bannerBody}>
        {title ? <b className={styles.bannerTitle}>{title}</b> : null}
        {children ? <span>{children}</span> : null}
        {action ? <div className={styles.bannerAction}>{action}</div> : null}
      </div>
    </div>
  );
}

type InlineErrorProps = {
  title: string;
  text: string;
  onRetry?: () => void;
};

// Errors are inline with Retry, never toast-only (frame H-offline).
export function InlineError({ title, text, onRetry }: InlineErrorProps) {
  return (
    <div role="alert" className={styles.inlineError}>
      <Icon icon={WarningCircle} size={20} className={styles.inlineErrorIcon} />
      <div className={styles.inlineErrorBody}>
        <span className={styles.inlineErrorTitle}>{title}</span>
        <span className={styles.muted}>{text}</span>
        {onRetry ? (
          <Button icon={ArrowClockwise} onClick={onRetry} className={styles.onSurface}>
            {strings.common.tryAgain}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type EmptyStateProps = {
  icon: IconComponent;
  /** One sentence (components.md). */
  text: string;
  /** One action. */
  action?: ReactNode;
};

// Values from frame H-rules ("No cards yet").
export function EmptyState({ icon, text, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <Icon icon={icon} size={32} className={styles.muted} />
      <span className={styles.emptyText}>{text}</span>
      {action}
    </div>
  );
}

type SkeletonProps = {
  /** Width and height of one static block (frame H-offline). */
  lines: ReadonlyArray<{ width: CSSProperties["width"]; height?: number; radius?: number }>;
  label: string;
};

// Static blocks; they shimmer only when motion is allowed (Design System, motion).
export function Skeleton({ lines, label }: SkeletonProps) {
  return (
    <div aria-busy="true" className={styles.skeleton}>
      <span className="rc-visually-hidden">{label}</span>
      {lines.map((line, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder blocks never reorder.
          key={index}
          className={styles.skeletonLine}
          style={{ width: line.width, height: line.height ?? 14, borderRadius: line.radius ?? 4 }}
        />
      ))}
    </div>
  );
}

type HeroCardProps = {
  children: ReactNode;
  className?: string;
};

/** The one lime surface per screen (HANDOFF §3). Not for warnings or when the learner is behind. */
export function HeroCard({ children, className }: HeroCardProps) {
  return <div className={["rc-hero", className].filter(Boolean).join(" ")}>{children}</div>;
}
