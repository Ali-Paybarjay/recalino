import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../../../packages/core/src/plt";
import { snapshotSourceSchema } from "../../../packages/core/src/proc/contracts";
import { buildKnowledgeInput } from "../../../packages/core/src/proc/knowledge-input";
import { decodeSourceText, extractPdfText } from "../../../packages/core/src/src";
import {
  baselineIdMap,
  baselineLearnerProfile,
  baselineSchedule,
  baselineSourceRows,
  compareSnapshotToFixture,
  expectedKnowledgeInput,
  holdout5FixturesHash,
  knowledgeInputInspector,
  mapIds,
  runExplanationLanguage,
  snapshotRoleOf,
  workerMissingSourceIds,
} from "./baseline-fixtures";
import { DispatchRefused } from "./cost-guard";
import type { MigrationFixture } from "./haiku55-migration-fixtures";
import { holdout5MigrationFixtures } from "./multilingual-holdout5-fixtures";

const fixtures = holdout5MigrationFixtures();
const fixture = (id: string) => {
  const found = fixtures.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};
/** Stand-in database identifiers, as createBaselineCase returns them. */
const databaseMapping = (lesson: MigrationFixture) =>
  lesson.sources.map((source, index) => ({
    fixtureSourceId: source.sourceId,
    sourceId: `0000000${index}-aaaa-4aaa-8aaa-${lesson.id.slice(1).padStart(12, "0")}`,
    fixtureContentVersionId: source.contentVersionId,
    contentVersionId: `0000000${index}-bbbb-4bbb-8bbb-${lesson.id.slice(1).padStart(12, "0")}`,
  }));
/**
 * The snapshot production builds from these uploads under the stand-in identifiers: verification
 * counts text pages from the decoded upload and PDF pages with the production parser.
 */
const databaseSnapshot = async (lesson: MigrationFixture) => {
  const mapping = databaseMapping(lesson);
  const sources = [];
  for (const [index, row] of baselineSourceRows(lesson).entries())
    sources.push(
      snapshotSourceSchema.parse({
        sourceId: mapping[index]?.sourceId,
        contentVersionId: mapping[index]?.contentVersionId,
        kind: row.declaration.kind,
        role: snapshotRoleOf(row),
        sha256: row.declaration.sha256,
        mimeType: row.declaration.mimeType,
        durationMs: row.declaration.durationMs ?? null,
        pageCount: !row.bytes
          ? null
          : row.declaration.kind === "pdf"
            ? (await extractPdfText(row.bytes, 200)).pageCount
            : Math.max(1, Math.ceil(decodeSourceText(row.bytes).length / 3000)),
        objectId: row.bytes ? "11111111-2222-4333-8444-555555555555" : null,
        ranges: [],
        captureAnchor: null,
        units: row.content.units,
        blocks: row.content.blocks,
      }),
    );
  return { sources };
};

describe("holdout-5 schedule", () => {
  it("runs the Gemini holdout-5 lessons unchanged in the same order with two repeats", () => {
    expect(sha256Hex(canonicalJson(fixtures))).toBe(holdout5FixturesHash);
    const schedule = baselineSchedule(fixtures);
    expect(schedule.map((task) => task.caseId)).toEqual([
      "S01-1",
      "S02-2",
      "S03-3",
      "S04-4",
      "S05-5",
      "S06-6",
      "S07-7",
      "S08-8",
      "S09-9",
      "S10-10",
      "S11-11",
      "S12-12",
      "S03-13",
      "S10-14",
    ]);
    expect(schedule.filter((task) => task.repeat).map((task) => task.caseId)).toEqual([
      "S03-13",
      "S10-14",
    ]);
    expect(schedule[12]?.fixture).toBe(fixture("S03"));
  });

  const geminiPlan =
    "C:/Users/Ali-PC/.codex/worktrees/haiku55-migration/Recalino/artifacts/verification/gemini38-holdout5-acceptance/dry-run-plan.json";
  it.skipIf(!existsSync(geminiPlan))(
    "matches the captured Gemini round's schedule and lessons",
    () => {
      const plan = JSON.parse(readFileSync(geminiPlan, "utf8"));
      expect(
        baselineSchedule().map(({ caseId, fixture, repeat }) => [caseId, fixture.id, repeat]),
      ).toEqual(
        plan.schedule.map((entry: { caseId: string }, index: number) => [
          entry.caseId,
          entry.caseId.split("-")[0],
          index >= 12,
        ]),
      );
      expect(plan.fixturesHash).toBe(holdout5FixturesHash);
    },
  );
});

describe("learner context", () => {
  it("gives every lesson its explanation language, declared level, goal and preference", () => {
    for (const lesson of fixtures) {
      const profile = baselineLearnerProfile(lesson);
      expect(runExplanationLanguage(profile)).toBe(lesson.explanationLanguage);
      expect(profile).toMatchObject({
        explanationLanguage: "first_language",
        firstLanguage: lesson.explanationLanguage,
        level: lesson.declaredLevel,
        goal: lesson.goal,
        shorterExamples: lesson.teachingPreferences.shorterExamples,
        classDate: lesson.lessonContext.date,
        course: lesson.lessonContext.course,
      });
    }
    expect(new Set(fixtures.map((lesson) => lesson.explanationLanguage))).toEqual(
      new Set(["fa", "ar", "es", "ja", "uk"]),
    );
  });

  it("explains in English through the English profile choice and refuses unknown languages", () => {
    const english = { ...fixture("S01"), explanationLanguage: "en" };
    const profile = baselineLearnerProfile(english);
    expect(profile.explanationLanguage).toBe("english");
    expect(runExplanationLanguage(profile)).toBe("en");
    expect(() => baselineLearnerProfile({ ...fixture("S01"), explanationLanguage: "xx" })).toThrow(
      "explanation_language_unsupported",
    );
  });
});

describe("fixture sources as production rows", () => {
  it("keeps every role the worker will see, including personal notes and class audio", () => {
    for (const lesson of fixtures)
      for (const row of baselineSourceRows(lesson))
        expect(snapshotRoleOf(row)).toBe(lesson.sources[row.index]?.role);
    expect(baselineSourceRows(fixture("S04")).map(snapshotRoleOf)).toEqual([
      "class_material",
      "user_notes",
    ]);
    const [, audio] = baselineSourceRows(fixture("S03"));
    // Class audio is declared with its duration and fixture checksum; it is never uploaded.
    expect(audio).toMatchObject({
      role: "class_audio",
      bytes: undefined,
      declaration: { kind: "audio", mimeType: "audio/wav", durationMs: 20000, parts: [] },
      content: { settings: {} },
    });
    expect(audio?.declaration.sha256).toBe(fixture("S03").sources[1]?.sha256);
    expect(audio?.content.units).toEqual([
      { id: "unit-1", kind: "time", start: 0, end: 10000, status: "extracted" },
      { id: "unit-2", kind: "time", start: 10000, end: 20000, status: "extracted" },
    ]);
  });

  it("reproduces units and blocks exactly and reports only failed material as missing", () => {
    for (const lesson of fixtures) {
      const rows = baselineSourceRows(lesson);
      expect(rows.map((row) => ({ units: row.content.units, blocks: row.content.blocks }))).toEqual(
        lesson.sources.map((source) => ({ units: source.units, blocks: source.blocks })),
      );
      expect(rows.filter((row) => row.missing).map((row) => row.fixtureSourceId)).toEqual(
        lesson.missingSourceIds,
      );
      expect(workerMissingSourceIds(lesson.sources)).toEqual(lesson.missingSourceIds);
    }
    const [pdf] = baselineSourceRows(fixture("S06"));
    expect(pdf?.declaration).toMatchObject({ kind: "pdf", mimeType: "application/pdf" });
    expect(pdf?.expected.pageCount).toBe(4);
    expect(pdf?.content.units[1]).toEqual({
      id: "unit-2",
      kind: "page",
      start: 2,
      status: "failed",
      reason: "unreadable_scan",
    });
    expect(pdf?.content.blocks.some((block) => block.unitId === "unit-2")).toBe(false);
  });

  it("uploads text and PDFs that production verification accepts with the fixture's pages", async () => {
    const [pdf] = baselineSourceRows(fixture("S06"));
    if (!pdf?.bytes) throw new Error("missing PDF upload");
    // The unreadable scan is a page without a text layer in the uploaded file as well.
    const parsed = await extractPdfText(pdf.bytes, 200);
    expect(parsed.pageCount).toBe(4);
    expect(parsed.units.map((unit) => unit.status)).toEqual([
      "extracted",
      "failed",
      "extracted",
      "extracted",
    ]);
    expect(pdf.declaration).toMatchObject({
      sizeBytes: pdf.bytes.byteLength,
      sha256: sha256Hex(pdf.bytes),
      parts: [{ index: 0, sizeBytes: pdf.bytes.byteLength, sha256: sha256Hex(pdf.bytes) }],
    });
    for (const lesson of fixtures)
      for (const row of baselineSourceRows(lesson).filter(
        (entry) => entry.declaration.kind === "text",
      )) {
        expect(decodeSourceText(row.bytes ?? new Uint8Array())).toBe(
          row.content.blocks.map((block) => block.text).join("\n\n"),
        );
        // A verified text upload always carries a page count; these lessons fit on one page.
        expect(row.expected.pageCount).toBe(1);
        expect({ ...row.expected, pageCount: null }).toEqual(
          snapshotSourceSchema.parse(lesson.sources[row.index]),
        );
      }
  });
});

describe("identifier mapping and input checks", () => {
  it("accepts the worker's snapshot only when every model-visible field equals the fixture", async () => {
    for (const lesson of fixtures) {
      const map = baselineIdMap(databaseMapping(lesson));
      expect(compareSnapshotToFixture(await databaseSnapshot(lesson), lesson, map)).toEqual([]);
    }
    const lesson = fixture("S04");
    const map = baselineIdMap(databaseMapping(lesson));
    const changed = await databaseSnapshot(lesson);
    const notes = changed.sources[1];
    if (!notes) throw new Error("missing notes");
    changed.sources[1] = { ...notes, role: "class_material" };
    const block = changed.sources[0]?.blocks[0];
    if (block) block.text = `${block.text} `;
    expect(compareSnapshotToFixture(changed, lesson, map)).toEqual([
      "source_1_blocks",
      "source_2_role",
    ]);
  });

  it("renames database identifiers in published output and leaves none behind", () => {
    const lesson = fixture("S06");
    const mapping = databaseMapping(lesson)[0];
    if (!mapping) throw new Error("missing mapping");
    const map = baselineIdMap([mapping]);
    const published = {
      coverage: { complete: false, missingSourceIds: [mapping.sourceId] },
      ref: { sourceId: mapping.sourceId, contentVersionId: mapping.contentVersionId },
    };
    expect(mapIds(published, map)).toEqual({
      coverage: { complete: false, missingSourceIds: [mapping.fixtureSourceId] },
      ref: { sourceId: mapping.fixtureSourceId, contentVersionId: mapping.fixtureContentVersionId },
    });
  });

  it("lets a knowledge dispatch through only when its input is this lesson's production input", async () => {
    const lesson = fixture("S03");
    const map = baselineIdMap(databaseMapping(lesson));
    const snapshot = await databaseSnapshot(lesson);
    const sent = buildKnowledgeInput(
      {
        explanationLanguage: lesson.explanationLanguage,
        teachingPreferences: lesson.teachingPreferences,
        learnerContext: { version: 1, declaredLevel: lesson.declaredLevel, goal: lesson.goal },
        sources: snapshot.sources,
        missingSourceIds: workerMissingSourceIds(snapshot.sources),
        lessonContext: lesson.lessonContext,
      },
      120000,
    ).input;
    const expected = expectedKnowledgeInput(lesson, 120000);
    const checks: unknown[] = [];
    const inspect = knowledgeInputInspector({
      expected,
      map: () => map,
      record: (check) => checks.push(check),
    });
    const body = (text: string) => ({
      model: "m",
      max_tokens: 1,
      provider: { zdr: true as const, data_collection: "deny" as const },
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: [{ type: "text", text }] },
      ],
    });
    expect(() => inspect({ stage: "knowledge", body: body(sent) })).not.toThrow();
    expect(() =>
      inspect({ stage: "knowledge", body: body(sent.replace("chemist's", "pharmacy")) }),
    ).toThrow(DispatchRefused);
    // Repairs and translations carry their own inputs and are not compared to the lesson input.
    expect(() => inspect({ stage: "knowledge:repair", body: body("{}") })).not.toThrow();
    expect(checks).toEqual([
      { stage: "knowledge", semanticMatch: true, stringIdentical: true },
      { stage: "knowledge", semanticMatch: false, stringIdentical: false },
    ]);
  });
});
