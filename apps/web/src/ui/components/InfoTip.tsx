"use client";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Info } from "../icons";
import { IconButton } from "./Button";
import styles from "./InfoTip.module.css";

/** The page's side gutter on a phone; the open box never comes closer to the screen edge. */
const GUTTER = 16;

type InfoTipProps = {
  /** Names the icon button, e.g. "About units". */
  label: string;
  /** Short help text, usually one to three paragraphs. */
  children: ReactNode;
};

/**
 * An "i" button that opens a short explanation below it (D48). Pressing it again, pressing
 * anywhere else, Escape or moving focus away closes it. The text stays in the document while
 * closed, so aria-controls always points at an element. It holds block content, so place it
 * next to a heading or label, never inside one or inside a paragraph.
 */
export function InfoTip({ label, children }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!open || !element) return;
    const pressOutside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) setOpen(false);
    };
    const pressEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      if (element.contains(document.activeElement)) button.current?.focus();
    };
    const leave = (event: FocusEvent) => {
      if (!element.contains(event.relatedTarget as Node | null)) setOpen(false);
    };
    document.addEventListener("pointerdown", pressOutside);
    document.addEventListener("keydown", pressEscape);
    element.addEventListener("focusout", leave);
    return () => {
      document.removeEventListener("pointerdown", pressOutside);
      document.removeEventListener("keydown", pressEscape);
      element.removeEventListener("focusout", leave);
    };
  }, [open]);

  // Move the open box sideways by as much as it would stick out of the screen.
  useLayoutEffect(() => {
    const element = box.current;
    if (!open || !element) return;
    const place = () => {
      element.style.translate = "";
      const { left, right } = element.getBoundingClientRect();
      const limit = document.documentElement.clientWidth - GUTTER;
      const offset = right > limit ? limit - right : left < GUTTER ? GUTTER - left : 0;
      if (offset) element.style.translate = `${offset}px 0`;
    };
    place();
    // Bring a box that opens below the screen, or behind the bottom navigation, into view.
    element.scrollIntoView?.({ block: "nearest" });
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  return (
    <div ref={root} className={styles.root}>
      <IconButton
        ref={button}
        icon={Info}
        label={label}
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      />
      {/* Focusable, so pressing inside the box to select text does not close it. */}
      <div ref={box} id={id} className={styles.box} hidden={!open} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
