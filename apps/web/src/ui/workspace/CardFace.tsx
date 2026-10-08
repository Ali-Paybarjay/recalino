"use client";
import { safeCardHtml } from "@recalino/core/card-html";
import { studyLexicalTarget, studyLexicalTargetMatches } from "@recalino/core/study-target";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./CardFace.module.css";
import pronunciationStyles from "./PronunciationAudio.module.css";

export interface CardFaceContent {
  front: string;
  back: string;
  contentFormat?: string;
}

export function CardFace({
  card,
  revealed = false,
  pronunciation,
}: {
  card: CardFaceContent;
  revealed?: boolean;
  pronunciation?: { target: string; control: ReactNode };
}) {
  const rich = card.contentFormat === "lesson_html";
  const content = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    target: string;
    face: string;
    slot: HTMLElement | null;
  } | null>(null);
  const target = pronunciation?.target;
  useEffect(() => {
    if (!revealed || !target) {
      setPlacement(null);
      return;
    }
    const anchor = [...(content.current?.querySelectorAll("b,strong") ?? [])].find((element) => {
      const lexical = studyLexicalTarget(element.textContent ?? "");
      return lexical && studyLexicalTargetMatches(lexical, target);
    });
    const slot = anchor ? document.createElement("span") : null;
    if (slot) anchor?.after(slot);
    setPlacement({ target, slot, face: `${card.front}\0${card.back}` });
    return () => {
      slot?.remove();
    };
  }, [revealed, target, card.front, card.back]);
  return (
    <div className={`${styles.face} fc-face`} dir="auto">
      {rich ? (
        <>
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=Vazirmatn:wght@400;600;800&display=swap"
            precedence="study-fonts"
          />
          <div
            ref={content}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped template fields checked against an inert tag and attribute allowlist.
            dangerouslySetInnerHTML={{
              __html: safeCardHtml(card.front) + (revealed ? `<hr>${safeCardHtml(card.back)}` : ""),
            }}
          />
        </>
      ) : (
        <>
          <div className={styles.plain} dir="auto">
            {card.front}
          </div>
          {revealed && (
            <>
              <hr />
              <div className={styles.plain} dir="auto">
                {card.back}
              </div>
            </>
          )}
        </>
      )}
      {revealed &&
        pronunciation &&
        placement &&
        placement.target === target &&
        placement.face === `${card.front}\0${card.back}` &&
        (placement.slot ? (
          createPortal(pronunciation.control, placement.slot)
        ) : (
          <div className={pronunciationStyles.fallback}>
            <span lang="en" dir="ltr">
              {target}
            </span>
            {pronunciation.control}
          </div>
        ))}
    </div>
  );
}
