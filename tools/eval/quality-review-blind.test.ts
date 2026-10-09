import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../../packages/core/src/plt";
import { holdoutMigrationFixtures } from "./haiku55-holdout-fixtures";
import { holdout3MigrationFixtures } from "./haiku55-holdout3-fixtures";
import { freshMigrationFixtures, type MigrationFixture } from "./haiku55-migration-fixtures";
import {
  assessMigrationQualityReview,
  migrationQualityReviewSchema,
} from "./haiku55-migration-quality";
import { comparisonFixtures } from "./model-comparison-fixtures";
import { holdout4MigrationFixtures } from "./multilingual-holdout4-fixtures";
import {
  assertBlindPacketClean,
  assertManifestOutsideBlindFolder,
  blindForbiddenNames,
  blindPacketLabel,
  buildBlindPackets,
  exportBlindQualityPackets,
} from "./quality-review-blind-export";
import {
  type BlindPacketManifest,
  blindAnswerKey,
  blindPacketDirectory,
  mergeBlindQualityReviews,
  readFrozenBlindRound,
  verifyBlindPacketFolder,
} from "./quality-review-blind-merge";

const [first, second] = freshMigrationFixtures();
if (!first || !second) throw new Error("Missing synthetic fixtures");
const fixtures = [first, second];
const conceptIds = (fixture: MigrationFixture) => fixture.expected.requiredConceptIds as string[];
// Two lessons and one repeat: the repeat shares its lesson but is a separate blind packet.
const results = [
  { caseId: `${first.id}-1`, fixtureId: first.id, finalLocalPass: true },
  { caseId: `${second.id}-2`, fixtureId: second.id, finalLocalPass: true },
  { caseId: `${first.id}-3`, fixtureId: first.id, finalLocalPass: true },
  { caseId: `${second.id}-4`, fixtureId: second.id, finalLocalPass: false },
];
const model = (caseId: string) => ({ summary: `Synthetic accepted model for ${caseId}` });

let directory: string;
let round: string;
let freeze: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "recalino-blind-"));
  round = join(directory, "round");
  const plan = {
    version: "synthetic",
    fixtureSet: "synthetic-holdout",
    model: "google/gemini-3.8-flash",
    acceptanceCandidate: { candidateId: "gemini-3.8-flash-medium" },
    fixturesHash: sha256Hex(canonicalJson(fixtures)),
  };
  freeze = sha256Hex(canonicalJson(plan));
  await mkdir(round, { recursive: true });
  await writeFile(
    join(round, "dry-run-plan.json"),
    JSON.stringify({ ...plan, freeze, paidCalls: 0 }),
  );
  await writeFile(
    join(round, "fixtures-and-ground-truth.json"),
    JSON.stringify({ syntheticOnly: true, cases: fixtures }),
  );
  await writeFile(
    join(round, "state.json"),
    JSON.stringify({ freeze, spentUsd: 0.1, stopped: false, requests: [], results }),
  );
  for (const result of results) {
    const dossier = join(round, "dossiers", result.caseId);
    await mkdir(dossier, { recursive: true });
    await writeFile(join(dossier, "final-model.json"), JSON.stringify(model(result.caseId)));
    await writeFile(join(dossier, "notes.html"), `<p>Notes ${result.caseId}</p>`);
    await writeFile(join(dossier, "cards.json"), JSON.stringify([{ id: result.caseId }]));
    await writeFile(join(dossier, "receipts.json"), '[{"model":"google/gemini-3.8-flash"}]');
  }
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const exportRound = (random = (upper: number) => upper - 1) =>
  exportBlindQualityPackets({
    out: round,
    blindDirectory: join(directory, "blind"),
    manifestPath: join(directory, "manifest.json"),
    random,
  });
const grade = (
  manifest: BlindPacketManifest,
  change: (entry: Record<string, unknown>, caseId: string) => void = () => undefined,
) =>
  manifest.packets.map((packet) => {
    const fixture = fixtures.find((entry) => entry.id === packet.lesson);
    if (!fixture) throw new Error("Unknown synthetic lesson");
    const entry: Record<string, unknown> = {
      lesson: packet.lesson,
      label: packet.label,
      scores: { correctness: 3, grounding: 3, coverage: 3, learnerFit: 3, clarityCardUsability: 3 },
      requiredConcepts: conceptIds(fixture).map((id) => ({
        id,
        adequatelyTaught: true,
        evidence: `taught ${id}`,
      })),
      criticalIssues: [],
    };
    change(entry, packet.caseId);
    return entry;
  });

describe("FR-PROC-003 PRD-QA-01 blind packet export", () => {
  it("labels packets A..Z then AA..ZZ", () => {
    expect([0, 1, 25, 26, 27, 701].map(blindPacketLabel)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "ZZ",
    ]);
    expect(() => blindPacketLabel(702)).toThrow("blind_label_out_of_range");
    expect(() => blindPacketLabel(-1)).toThrow("blind_label_out_of_range");
  });
  it("names every candidate model, vendor, family and router, but no ordinary word", () => {
    const names = blindForbiddenNames({
      model: "synthetic/other-model-1",
      acceptanceCandidate: { candidateId: "synthetic-candidate" },
    });
    for (const name of [
      "google",
      "gemini",
      "google/gemini-3.8-flash",
      "gemini-3.8-flash-medium-schema",
      "anthropic",
      "claude",
      "claude-haiku-5.5",
      "openrouter",
      "synthetic/other-model-1",
      "synthetic-candidate",
    ])
      expect(names).toContain(name);
    for (const word of ["flash", "lite", "medium", "low"]) expect(names).not.toContain(word);
  });
  it("refuses a packet that names a model or provider, matching whole names only", () => {
    const names = blindForbiddenNames({});
    const packet = (text: string) => [{ path: "R01/A/notes.html", bytes: Buffer.from(text) }];
    for (const text of ["Made by Gemini", "via OpenRouter", "google-vertex", "CLAUDE notes"])
      expect(() => assertBlindPacketClean(packet(text), names)).toThrow(
        "blind_packet_names_model_or_provider",
      );
    for (const text of ["I googled the flashcards", "geminis", "Claudette"])
      expect(() => assertBlindPacketClean(packet(text), names)).not.toThrow();
  });
  it("finds a name that runs into Japanese, Chinese or Arabic-script text or is fullwidth", () => {
    const names = blindForbiddenNames({ model: "google/gemini-3.8-flash" });
    const packet = (text: string) => [{ path: "R01/A/notes.html", bytes: Buffer.from(text) }];
    for (const text of [
      "こんにちは、私はGeminiです。",
      "このノートはClaudeが作りました。",
      "由Gemini生成的笔记",
      "私はＧｅｍｉｎｉです",
      "ＯｐｅｎＲｏｕｔｅｒ経由",
      "أنابClaude",
      "این جزوه را Geminiساخت",
      "Это сделал Claudeом",
    ])
      expect(() => assertBlindPacketClean(packet(text), names)).toThrow(
        "blind_packet_names_model_or_provider",
      );
    for (const text of ["ジェミニは星座です", "双子座的笔记", "Ｇｅｍｉｎｉｓ", "googled"])
      expect(() => assertBlindPacketClean(packet(text), names)).not.toThrow();
  });
  it("finds no model or provider name in any synthetic answer key", () => {
    const all = [
      ...comparisonFixtures(),
      ...holdoutMigrationFixtures(),
      ...holdout3MigrationFixtures(),
      ...freshMigrationFixtures(),
      ...holdout4MigrationFixtures(),
    ];
    expect(() =>
      assertBlindPacketClean(
        all.map((fixture) => ({ path: fixture.id, bytes: blindAnswerKey(fixture) })),
        blindForbiddenNames({}),
      ),
    ).not.toThrow();
  });
  it("keeps the manifest outside the blind folder", () => {
    expect(() => assertManifestOutsideBlindFolder("out/blind", "out/blind/manifest.json")).toThrow(
      "blind_manifest_inside_blind_folder",
    );
    expect(() => assertManifestOutsideBlindFolder("out/blind", "out/blind")).toThrow(
      "blind_manifest_inside_blind_folder",
    );
    expect(() =>
      assertManifestOutsideBlindFolder("out/blind", "out/blind-manifest.json"),
    ).not.toThrow();
  });
  it("shuffles accepted cases into four-file packets bound by hash", async () => {
    const accepted = (await readFrozenBlindRound(round)).acceptedCases;
    expect(accepted.map((entry) => entry.caseId)).toEqual(
      results.filter((result) => result.finalLocalPass).map((result) => result.caseId),
    );
    const built = buildBlindPackets({
      freeze,
      acceptedCases: accepted,
      fixtures,
      forbiddenNames: blindForbiddenNames({}),
      random: () => 0,
    });
    expect(built.packets.map((packet) => packet.label).sort()).toEqual(["A", "B", "C"]);
    expect(built.packets.map((packet) => packet.label)).not.toEqual(["A", "B", "C"]);
    for (const packet of built.packets)
      expect(Object.keys(packet.files).sort()).toEqual([
        "answer-key.json",
        "cards.json",
        "final-model.json",
        "notes.html",
      ]);
    const repeat = built.manifest.packets.find((packet) => packet.caseId === `${first.id}-3`);
    expect(repeat?.finalModelSha256).toBe(
      sha256Hex(Buffer.from(JSON.stringify(model(`${first.id}-3`)))),
    );
    expect(() =>
      buildBlindPackets({
        freeze,
        acceptedCases: [
          { ...accepted[0], finalModel: Buffer.from('{"by":"anthropic/claude-haiku-5.5"}') },
        ] as typeof accepted,
        fixtures,
        forbiddenNames: blindForbiddenNames({}),
        random: () => 0,
      }),
    ).toThrow("blind_packet_names_model_or_provider");
    expect(() =>
      buildBlindPackets({
        freeze,
        acceptedCases: [],
        fixtures,
        forbiddenNames: [],
        random: () => 0,
      }),
    ).toThrow("blind_export_has_no_accepted_case");
  });
  it("writes only the four files per packet into a fresh folder and the manifest outside it", async () => {
    const manifest = await exportRound();
    expect(manifest.freeze).toBe(freeze);
    const blind = join(directory, "blind");
    expect((await readdir(blind)).sort()).toEqual([first.id, second.id].sort());
    for (const packet of manifest.packets) {
      const folder = blindPacketDirectory(blind, packet);
      expect((await readdir(folder)).sort()).toEqual([
        "answer-key.json",
        "cards.json",
        "final-model.json",
        "notes.html",
      ]);
      expect(await readFile(join(folder, "final-model.json"))).toEqual(
        await readFile(join(round, "dossiers", packet.caseId, "final-model.json")),
      );
    }
    const blindText = JSON.stringify(await readdir(blind, { recursive: true }));
    for (const result of results) expect(blindText).not.toContain(result.caseId);
    await expect(exportRound()).rejects.toThrow();
    const edited = manifest.packets[0];
    if (!edited) throw new Error("Missing packet");
    await writeFile(join(blindPacketDirectory(blind, edited), "notes.html"), "<p>edited</p>");
    await expect(verifyBlindPacketFolder(blind, manifest)).rejects.toThrow(
      "blind_folder_differs_from_manifest",
    );
  });
  it("refuses a round whose plan, freeze or answer keys were edited", async () => {
    await expect(readFrozenBlindRound(round, "b".repeat(64))).rejects.toThrow("another freeze");
    const planPath = join(round, "dry-run-plan.json");
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    await writeFile(planPath, JSON.stringify({ ...plan, model: "edited" }));
    await expect(readFrozenBlindRound(round)).rejects.toThrow("differs from its freeze");
    await writeFile(planPath, JSON.stringify(plan));
    await writeFile(
      join(round, "fixtures-and-ground-truth.json"),
      JSON.stringify({ cases: [first] }),
    );
    await expect(readFrozenBlindRound(round)).rejects.toThrow("answer keys differ");
  });
});

describe("FR-PROC-003 PRD-QA-01 conservative blind review merge", () => {
  const merge = async (graders: { name: string; review: unknown }[], manifest?: unknown) => {
    const exported = await exportRound();
    const frozen = await readFrozenBlindRound(round, freeze);
    return mergeBlindQualityReviews({
      freeze,
      manifest: manifest ?? exported,
      acceptedCases: frozen.acceptedCases,
      graders,
    });
  };
  it("unions critical issues, ANDs concepts and takes the lowest-mean grader's scores", async () => {
    const manifest = await exportRound();
    const frozen = await readFrozenBlindRound(round, freeze);
    const repeat = `${first.id}-3`;
    const merged = mergeBlindQualityReviews({
      freeze,
      manifest,
      acceptedCases: frozen.acceptedCases,
      graders: [
        {
          name: "grader-a",
          review: grade(manifest, (entry, caseId) => {
            if (caseId === repeat)
              entry.criticalIssues = [{ category: "language", detail: "Wrong script" }];
            entry.scores = {
              correctness: 4,
              grounding: 4,
              coverage: 3,
              learnerFit: 3,
              clarityCardUsability: 3,
              explanationLanguageQuality: 1,
            };
          }),
        },
        {
          name: "grader-b",
          review: grade(manifest, (entry, caseId) => {
            if (caseId === `${second.id}-2`) {
              entry.criticalIssues = [{ category: "teaching", detail: "Wrong rule" }];
              const [concept] = entry.requiredConcepts as { adequatelyTaught: boolean }[];
              if (concept) concept.adequatelyTaught = false;
            }
          }),
        },
      ],
    });
    expect(migrationQualityReviewSchema.parse(merged)).toEqual(merged);
    const byCase = new Map(merged.cases.map((entry) => [entry.caseId, entry]));
    expect(byCase.get(repeat)?.criticalIssues).toEqual([
      { category: "language", detail: "Wrong script" },
    ]);
    expect(byCase.get(`${second.id}-2`)?.criticalIssues).toEqual([
      { category: "teaching", detail: "Wrong rule" },
    ]);
    expect(byCase.get(`${second.id}-2`)?.requiredConcepts[0]?.adequatelyTaught).toBe(false);
    expect(byCase.get(`${first.id}-1`)?.requiredConcepts.every((c) => c.adequatelyTaught)).toBe(
      true,
    );
    // grader-b's five-score mean (3.0) is below grader-a's (3.4), so its full set is used.
    for (const entry of merged.cases)
      expect(entry.scores).toEqual({
        correctness: 3,
        grounding: 3,
        coverage: 3,
        learnerFit: 3,
        clarityCardUsability: 3,
      });
    expect(byCase.get(repeat)?.modelHash).toBe(sha256Hex(canonicalJson(model(repeat))));
    const assessed = assessMigrationQualityReview(
      {
        freeze,
        completedCases: 3,
        expectedCases: 3,
        finalLocalPasses: 3,
        firstGenerationPasses: 3,
        unexpectedTransportFallbacks: 0,
        stopped: false,
        unresolved: [],
      },
      frozen.acceptedCases.map((entry) => ({
        caseId: entry.caseId,
        requiredConceptIds: entry.requiredConceptIds,
        modelHash: sha256Hex(canonicalJson(model(entry.caseId))),
      })),
      merged,
      {
        fixtureSet: "synthetic-holdout",
        candidateId: "gemini-3.8-flash-medium",
        model: "google/gemini-3.8-flash",
        structuredOutputMode: "json_object",
        directJsonMode: true,
      },
    );
    expect(assessed.criticalIssues).toBe(2);
    expect(assessed.cases.find((entry) => entry.caseId === repeat)?.qualityPassed).toBe(false);
    expect(assessed.adoptionEligible).toBe(false);
  });
  it("breaks an equal-mean tie by grader name, deterministically", async () => {
    const manifest = await exportRound();
    const frozen = await readFrozenBlindRound(round, freeze);
    const shape = (correctness: number, coverage: number) => (entry: Record<string, unknown>) => {
      entry.scores = {
        correctness,
        grounding: 3,
        coverage,
        learnerFit: 3,
        clarityCardUsability: 3,
      };
    };
    const graders = [
      { name: "zeta", review: grade(manifest, shape(4, 2)) },
      { name: "alpha", review: grade(manifest, shape(2, 4)) },
    ];
    for (const order of [graders, [...graders].reverse()])
      expect(
        mergeBlindQualityReviews({
          freeze,
          manifest,
          acceptedCases: frozen.acceptedCases,
          graders: order,
        }).cases[0]?.scores,
      ).toMatchObject({ correctness: 2, coverage: 4 });
  });
  it("rejects a packet whose bytes differ from the frozen dossier", async () => {
    const manifest = await exportRound();
    await writeFile(
      join(round, "dossiers", `${first.id}-1`, "final-model.json"),
      JSON.stringify({ summary: "edited after export" }),
    );
    const frozen = await readFrozenBlindRound(round, freeze);
    expect(() =>
      mergeBlindQualityReviews({
        freeze,
        manifest,
        acceptedCases: frozen.acceptedCases,
        graders: [{ name: "grader-a", review: grade(manifest) }],
      }),
    ).toThrow("blind_packet_hash_mismatch");
  });
  it("rejects unknown labels, unreviewed cases, duplicates and incomplete concept judgments", async () => {
    const manifest = await exportRound();
    const frozen = await readFrozenBlindRound(round, freeze);
    const run = (review: unknown, packets: unknown = manifest) =>
      mergeBlindQualityReviews({
        freeze,
        manifest: packets,
        acceptedCases: frozen.acceptedCases,
        graders: [{ name: "grader-a", review }],
      });
    const unknown = grade(manifest);
    Object.assign(unknown[0] ?? {}, { label: "Z" });
    expect(() => run(unknown)).toThrow("blind_review_unknown_label");
    const swapped = grade(manifest);
    const other = manifest.packets.find((packet) => packet.lesson !== swapped[0]?.lesson);
    Object.assign(swapped[0] ?? {}, { lesson: other?.lesson });
    expect(() => run(swapped)).toThrow("blind_review_unknown_label");
    expect(() => run(grade(manifest).slice(1))).toThrow("blind_case_not_reviewed");
    const duplicate = grade(manifest);
    expect(() => run([...duplicate, duplicate[0]])).toThrow("blind_review_duplicate_packet");
    const incomplete = grade(manifest);
    (incomplete[0]?.requiredConcepts as unknown[] | undefined)?.pop();
    expect(() => run(incomplete)).toThrow("blind_review_requires_all_predeclared_concepts");
    expect(() => run(grade(manifest), { ...manifest, freeze: "b".repeat(64) })).toThrow(
      "blind_manifest_freeze_mismatch",
    );
    expect(() => run(grade(manifest), { ...manifest, packets: manifest.packets.slice(1) })).toThrow(
      "blind_manifest_case_set_mismatch",
    );
    expect(() =>
      mergeBlindQualityReviews({
        freeze,
        manifest,
        acceptedCases: frozen.acceptedCases,
        graders: [
          { name: "same", review: grade(manifest) },
          { name: "same", review: grade(manifest) },
        ],
      }),
    ).toThrow("blind_grader_names_invalid");
  });
  it("requires a judgment for every accepted case even from a single grader", async () => {
    await expect(merge([{ name: "only", review: [] }])).rejects.toThrow("blind_case_not_reviewed");
  });
});
