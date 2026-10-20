import type { ReactNode } from "react";
import {
  ChalkboardSimple,
  CheckCircle,
  CircleDashed,
  CircleHalf,
  CircleNotch,
  DeviceMobile,
  DeviceMobileSlash,
  FileDashed,
  FilePdf,
  Flask,
  HandPointing,
  HourglassMedium,
  Image,
  Lightbulb,
  Pause,
  PencilSimpleLine,
  Play,
  Prohibit,
  Queue,
  WarningCircle,
  XCircle,
} from "../icons";
import { fill } from "../strings-fill";
import { statusStrings as strings } from "../strings-status";
import { ContentBlock } from "./ContentBlock";
import { Icon, type IconComponent } from "./Icon";
import styles from "./Status.module.css";

// Status and provenance are always icon + text + colour, never colour alone (HANDOFF §3).

type Tone = "info" | "warning" | "primary" | "success" | "danger";

export type ClassStatus =
  | { status: "readyToProcess" }
  | { status: "waitingForAllowance" }
  | { status: "inQueue" }
  | { status: "processing" }
  | { status: "needsAction" }
  | { status: "partlyReady"; detail: string }
  | { status: "ready" }
  | { status: "failed" }
  | { status: "cancelled" };

const CLASS_STATUS: Record<ClassStatus["status"], { tone: Tone; icon: IconComponent }> = {
  readyToProcess: { tone: "info", icon: CircleDashed },
  waitingForAllowance: { tone: "warning", icon: HourglassMedium },
  inQueue: { tone: "info", icon: Queue },
  processing: { tone: "primary", icon: CircleNotch },
  needsAction: { tone: "warning", icon: HandPointing },
  partlyReady: { tone: "primary", icon: CircleHalf },
  ready: { tone: "success", icon: CheckCircle },
  failed: { tone: "danger", icon: WarningCircle },
  cancelled: { tone: "info", icon: Prohibit },
};

/** "Partly ready" always names what is missing (components.md), so the type requires it. */
export function ClassStatusChip(props: ClassStatus) {
  const { tone, icon } = CLASS_STATUS[props.status];
  const text =
    props.status === "partlyReady"
      ? fill(strings.classStatus.partlyReady, { detail: props.detail })
      : strings.classStatus[props.status];
  return (
    <span className={`${styles.chip} ${styles[tone]}`}>
      <Icon icon={icon} />
      {text}
    </span>
  );
}

export type SourceStatusValue =
  | { status: "onThisDevice" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "serverCopyDeleted" }
  | { status: "notOnThisDevice" }
  | { status: "uploading"; done: number; total: number }
  | { status: "checking" }
  | { status: "received" }
  | { status: "notAccepted"; reason: string }
  | { status: "needsAction"; action: string };

type TextTone = "muted" | "success" | "danger" | "warning";

// Frames C1, C4 and the Design System source rows. States without a frame use the closest one:
// in progress = muted + spinner, done = success + check, unavailable = muted.
const SOURCE_STATUS: Record<SourceStatusValue["status"], { tone: TextTone; icon?: IconComponent }> =
  {
    onThisDevice: { tone: "success", icon: DeviceMobile },
    sending: { tone: "muted", icon: CircleNotch },
    sent: { tone: "success", icon: CheckCircle },
    serverCopyDeleted: { tone: "muted", icon: CheckCircle },
    notOnThisDevice: { tone: "muted", icon: DeviceMobileSlash },
    uploading: { tone: "muted" },
    checking: { tone: "muted", icon: CircleNotch },
    received: { tone: "success", icon: CheckCircle },
    notAccepted: { tone: "danger", icon: XCircle },
    needsAction: { tone: "warning", icon: HandPointing },
  };

function sourceStatusText(value: SourceStatusValue): string {
  switch (value.status) {
    case "uploading":
      return fill(strings.sourceStatus.uploading, { done: value.done, total: value.total });
    case "notAccepted":
      return fill(strings.sourceStatus.notAccepted, { reason: value.reason });
    case "needsAction":
      return fill(strings.sourceStatus.needsAction, { action: value.action });
    default:
      return strings.sourceStatus[value.status];
  }
}

export function SourceStatus(props: SourceStatusValue) {
  const { tone, icon } = SOURCE_STATUS[props.status];
  const text = sourceStatusText(props);
  if (props.status === "uploading") {
    const percent = props.total > 0 ? Math.min(100, (props.done / props.total) * 100) : 0;
    return (
      <span className={styles.upload}>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.bar} style={{ width: `${percent}%` }} />
        </span>
        <span className={styles[tone]}>{text}</span>
      </span>
    );
  }
  return (
    <span className={`${styles.statusText} ${styles[tone]}`}>
      {icon ? <Icon icon={icon} /> : null}
      {text}
    </span>
  );
}

export type ProvenanceKind = "class" | "ai" | "edited";

const PROVENANCE: Record<ProvenanceKind, IconComponent> = {
  class: ChalkboardSimple,
  ai: Lightbulb,
  edited: PencilSimpleLine,
};

type ProvenanceLabelProps = {
  kind: ProvenanceKind;
  /** e.g. "Teacher (confirmed by you)" or a date. */
  detail?: string;
};

export function ProvenanceLabel({ kind, detail }: ProvenanceLabelProps) {
  return (
    <span className={`${styles.provenance} ${styles[`prov_${kind}`]}`}>
      <Icon icon={PROVENANCE[kind]} />
      {detail ? `${strings.provenance[kind]} · ${detail}` : strings.provenance[kind]}
    </span>
  );
}

type ProvenanceBlockProps = ProvenanceLabelProps & {
  children: ReactNode;
  lang?: string;
  dir?: "ltr" | "rtl" | "auto";
};

/** Plain for class content, solid tint for AI, dashed tint for edits (Design System §5). */
export function ProvenanceBlock({ kind, detail, children, lang, dir }: ProvenanceBlockProps) {
  return (
    <div className={`${styles.block} ${styles[`block_${kind}`]}`}>
      <ProvenanceLabel kind={kind} detail={detail} />
      <ContentBlock lang={lang} dir={dir} className={styles.blockContent}>
        {children}
      </ContentBlock>
    </div>
  );
}

export type SourceRef =
  | { type: "audio"; label: string }
  | { type: "page"; label: string }
  | { type: "photo"; label: string };

type SourceChipProps = {
  source: SourceRef;
  availability?: "available" | "notOnDevice" | "notKept";
  playing?: boolean;
  onOpen?: () => void;
};

const SOURCE_ICON: Record<SourceRef["type"], IconComponent> = {
  audio: Play,
  page: FilePdf,
  photo: Image,
};

/**
 * A link back to the class source. An unavailable source stays readable and focusable and opens
 * an explanation, never a broken link (HANDOFF §5.4). 32px visual, 44px hit area.
 */
export function SourceChip({
  source,
  availability = "available",
  playing = false,
  onOpen,
}: SourceChipProps) {
  if (availability !== "available") {
    const template =
      availability === "notOnDevice"
        ? strings.sourceChip.notOnThisDevice
        : strings.sourceChip.notKept;
    return (
      <button
        type="button"
        className={`${styles.sourceChip} ${styles.unavailable}`}
        onClick={onOpen}
      >
        <Icon icon={availability === "notOnDevice" ? DeviceMobileSlash : FileDashed} />
        {fill(template, { label: source.label })}
      </button>
    );
  }
  const icon = source.type === "audio" && playing ? Pause : SOURCE_ICON[source.type];
  return (
    <button
      type="button"
      className={[styles.sourceChip, playing && styles.playing].filter(Boolean).join(" ")}
      aria-pressed={source.type === "audio" ? playing : undefined}
      onClick={onOpen}
    >
      <Icon icon={icon} className={styles.sourceIcon} />
      {source.label}
    </button>
  );
}

/** Marks content in a language that has not passed the quality check (D31). */
export function ExperimentalBadge() {
  return (
    <span className={styles.badge}>
      <Icon icon={Flask} />
      {strings.provenance.experimental}
    </span>
  );
}
