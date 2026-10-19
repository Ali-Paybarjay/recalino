// No "use client": a sheet always lives inside a client component that owns `open` and
// passes callbacks, so it joins that client bundle.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { X } from "../icons";
import { shellStrings as strings } from "../strings-shell";
import { Button, IconButton } from "./Button";
import { Checkbox } from "./Checkbox";
import styles from "./Sheet.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab from the last control goes to the first, Shift+Tab from the first to the last. */
function keepFocusInside(dialog: HTMLDialogElement, event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const controls = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0,
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Opens a native modal <dialog> while `open` is true. The page behind becomes inert and focus
 * stays inside; Esc asks the owner to close. On close, focus returns to the element that had it
 * before (accessibility.md: "B2 / any sheet or dialog").
 */
function useModal(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    openRef.current = open;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    const handleClose = () => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
      // Only when the browser closed it itself (e.g. a second Esc) is the owner told: a close the
      // owner asked for, such as after Confirm, must not also count as the safe choice.
      if (openRef.current) onCloseRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => keepFocusInside(dialog, event);
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return dialogRef;
}

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: "default" | "reading";
  footer?: ReactNode;
};

// A bottom sheet on mobile that becomes a centred 480px dialog from 1024px (HANDOFF §4).
// Values from frames B2-sheet and B2-dialog. Focus moves to the title when it opens.
export function Sheet({ open, onClose, title, children, variant = "default", footer }: SheetProps) {
  const dialogRef = useModal(open, onClose);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={`${styles.modal} ${styles.sheet} ${variant === "reading" ? styles.reading : ""}`}
    >
      <div className={styles.handle} aria-hidden="true" />
      <div className={styles.header}>
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title}>
          {title}
        </h2>
        <IconButton icon={X} label={strings.common.close} onClick={onClose} />
      </div>
      <div className={styles.content}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </dialog>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  /** Called for the safe choice, Esc included. */
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** Every consequence, one per line (frame H-rules). */
  consequences: readonly string[];
  safeLabel: string;
  confirmLabel: string;
  /** Adds "I understand this can't be undone" — only for losing un-sent audio (frame C3). */
  requireAck?: boolean;
  /** Frame C3: the safe choice is the filled primary. Elsewhere it is secondary (frame H-rules). */
  safeIsPrimary?: boolean;
};

// Destructive confirm. Focus starts on the safe action (accessibility.md). Values from frames
// C3-discard (mobile) and H-rules.
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  consequences,
  safeLabel,
  confirmLabel,
  requireAck = false,
  safeIsPrimary = false,
}: ConfirmDialogProps) {
  const dialogRef = useModal(open, onClose);
  const safeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (open) {
      setAcknowledged(false);
      safeRef.current?.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={`${styles.modal} ${styles.confirm}`}
    >
      <h2 id={titleId} className={styles.confirmTitle}>
        {title}
      </h2>
      <ul id={bodyId} className={styles.consequences}>
        {consequences.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {requireAck ? (
        <Checkbox
          label={strings.common.confirmIrreversible}
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
      ) : null}
      <div className={styles.actions}>
        <Button ref={safeRef} variant={safeIsPrimary ? "primary" : "secondary"} onClick={onClose}>
          {safeLabel}
        </Button>
        <Button variant="danger" disabled={requireAck && !acknowledged} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
