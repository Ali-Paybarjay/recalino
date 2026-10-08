import { expect, it } from "vitest";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { buildStudyAnkiText, studyExportFilename } from "./study-export";
import { renderStudyCard } from "./study-render";

it("exports separate Basic decks with exact safe faces, five headers and three TSV columns", () => {
  const model = referenceStudyModel();
  const cards = model.learningItems.map((item) => ({
    ...renderStudyCard(item),
    contentFormat: "lesson_html" as const,
    studySet: item.study?.set,
    studyTags: ["2026-10-05", "binomials", item.study?.set ?? ""],
  }));
  const output = buildStudyAnkiText(cards, {
    set: "production",
    deckName: "Claude ESOL class",
    courseTag: "cambria",
  });
  const lines = output.trimEnd().split("\n");
  expect(lines.slice(0, 5)).toEqual([
    "#separator:tab",
    "#html:true",
    "#notetype:Basic",
    "#deck:Claude ESOL class",
    "#tags column:3",
  ]);
  expect(lines.slice(5)).toHaveLength(3);
  expect(lines[5]?.split("\t").slice(0, 2)).toEqual([cards[0]?.front, cards[0]?.back]);
  for (const line of lines.slice(5)) {
    expect(line.split("\t")).toHaveLength(3);
    expect(line.split("\t")[2]).toBe("2026-10-05 binomials cambria production");
  }
  expect(studyExportFilename(cards, "recognition")).toBe("class-2026-10-05-extra.txt");
  expect(buildStudyAnkiText(cards, { set: "recognition", deckName: "Extras" })).not.toContain(
    cards[0]?.front,
  );
});

it("normalizes stray field controls and rejects active markup even with a forged rich flag", () => {
  const output = buildStudyAnkiText(
    [
      {
        contentFormat: "lesson_html",
        studySet: "production",
        front: "<script>alert(1)</script>\nhello\tthere",
        back: '<div dir="rtl">جواب</div>',
        studyTags: ["unsafe tag\nvalue"],
      },
    ],
    { set: "production", deckName: "Name\n#html:false", courseTag: "course tag" },
  );
  const rows = output.trimEnd().split("\n");
  expect(rows).toHaveLength(6);
  expect(rows[5]?.split("\t")).toHaveLength(3);
  expect(output).not.toContain("<script>");
  expect(output).toContain("<br>hello there");
});
