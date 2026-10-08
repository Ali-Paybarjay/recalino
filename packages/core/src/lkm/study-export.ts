import { safeCardHtml } from "./card-html";

export interface StudyExportCard {
  front: string;
  back: string;
  contentFormat?: "lesson_html";
  studySet?: "production" | "recognition";
  studyTags?: string[];
}

function oneLine(value: string): string {
  return value.replace(/\r\n?|\n/g, "<br>").replace(/\t/g, " ");
}
function tag(value: string): string {
  return value.trim().replace(/[^\p{L}\p{N}_:.-]/gu, "_");
}

/** Basic TSV: generated faces are identical to in-app faces, with one row per goal. */
export function buildStudyAnkiText(
  cards: readonly StudyExportCard[],
  options: { set: "production" | "recognition"; deckName: string; courseTag?: string },
): string {
  const deck = options.deckName.replace(/[\r\n\t]/g, " ").trim() || "Recalino";
  const rows = cards
    .filter((card) => card.contentFormat === "lesson_html" && card.studySet === options.set)
    .map((card) => {
      const tags = [
        ...(card.studyTags ?? []).filter(
          (value) => value !== "production" && value !== "recognition",
        ),
        options.courseTag ?? "",
      ]
        .map(tag)
        .filter(Boolean);
      return [
        oneLine(safeCardHtml(card.front)),
        oneLine(safeCardHtml(card.back)),
        [...new Set(tags), options.set].join(" "),
      ].join("\t");
    });
  return `${[
    "#separator:tab",
    "#html:true",
    "#notetype:Basic",
    `#deck:${deck}`,
    "#tags column:3",
    ...rows,
  ].join("\n")}\n`;
}

export function studyExportFilename(
  cards: readonly StudyExportCard[],
  set: "production" | "recognition",
): string {
  const date = cards
    .flatMap((card) => card.studyTags ?? [])
    .find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  return `class${date ? `-${date}` : ""}${set === "recognition" ? "-extra" : ""}.txt`;
}
