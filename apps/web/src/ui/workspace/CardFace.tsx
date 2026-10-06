import { safeCardHtml } from "@recalino/core/card-html";
import styles from "./CardFace.module.css";

export interface CardFaceContent {
  front: string;
  back: string;
  contentFormat?: string;
}

export function CardFace({
  card,
  revealed = false,
}: {
  card: CardFaceContent;
  revealed?: boolean;
}) {
  const rich = card.contentFormat === "lesson_html";
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
    </div>
  );
}
