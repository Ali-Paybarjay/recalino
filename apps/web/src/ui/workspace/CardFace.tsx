"use client";
import { cardHtmlWithLanguages } from "@recalino/core/card-html";
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
    const group = anchor ? document.createElement("span") : null;
    if (anchor && slot && group) {
      group.className = styles.pronunciationGroup ?? "";
      group.dir = "ltr";
      slot.className = styles.pronunciationSlot ?? "";
      anchor.before(group);
      group.append(anchor, slot);
    }
    setPlacement({ target, slot, face: `${card.front}\0${card.back}` });
    return () => {
      slot?.remove();
      if (group && anchor?.parentNode === group) group.replaceWith(anchor);
      else group?.remove();
    };
  }, [revealed, target, card.front, card.back]);
  return (
    <div className={`${styles.face} fc-face`} dir="auto">
      {rich ? (
        <>
          {/* SEC-04 (owner decision 2026-10-19): no web font; CardFace.module.css names the
              device's own font stacks, so opening a card reaches no other server. */}
          <div
            ref={content}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped template fields checked against an inert tag and attribute allowlist.
            dangerouslySetInnerHTML={{
              // A11Y-02: the stored faces stay as rendered; display adds the lang they leave out.
              __html:
                cardHtmlWithLanguages(card.front) +
                (revealed ? `<hr>${cardHtmlWithLanguages(card.back)}` : ""),
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
