import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "../../packages/core/node_modules/zod";
import { canonicalJson, sha256Hex } from "../../packages/core/src/plt";
import { type MigrationFixture, migrationFixtureSchema } from "./haiku55-migration-fixtures";
import { assertMigrationPlanFrozen, migrationRoundStateSchema } from "./haiku55-migration-guards";
import {
  type MigrationQualityReview,
  migrationCriticalIssueSchema,
  migrationQualityMean,
  migrationQualityReviewSchema,
  migrationQualityScoresSchema,
  migrationRequiredConceptSchema,
} from "./haiku55-migration-quality";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/**
 * Written by the blind export outside the blind folder: which frozen case each lesson + label
 * packet holds, and the exact bytes graders saw.
 */
export const blindPacketManifestSchema = z.strictObject({
  version: z.literal(1),
  freeze: sha256,
  packets: z
    .array(
      z.strictObject({
        lesson: z.string().regex(/^[A-Za-z0-9-]+$/),
        label: z.string().regex(/^[A-Z]{1,2}$/),
        caseId: z.string().min(1),
        finalModelSha256: sha256,
        notesSha256: sha256,
        cardsSha256: sha256,
        answerKeySha256: sha256,
      }),
    )
    .min(1),
});
export type BlindPacketManifest = z.infer<typeof blindPacketManifestSchema>;
/** One grader file: judgments keyed only by the blind lesson and label. */
export const blindGraderReviewSchema = z.array(
  z.strictObject({
    lesson: z.string().min(1),
    label: z.string().min(1),
    scores: migrationQualityScoresSchema,
    requiredConcepts: z.array(migrationRequiredConceptSchema),
    criticalIssues: z.array(migrationCriticalIssueSchema),
    minorIssues: z.array(z.string()).optional(),
  }),
);
type BlindJudgment = z.infer<typeof blindGraderReviewSchema>[number];

/** An accepted case of the frozen round, with the exact dossier bytes its packet was copied from. */
export type BlindRoundCase = {
  caseId: string;
  fixtureId: string;
  requiredConceptIds: string[];
  finalModel: Uint8Array;
  notes: Uint8Array;
  cards: Uint8Array;
  answerKey: Uint8Array;
};

/** The only files a blind packet holds; receipts, request bodies and the plan never enter it. */
export const blindPacketFiles = {
  finalModel: "final-model.json",
  notes: "notes.html",
  cards: "cards.json",
  answerKey: "answer-key.json",
} as const;

/** The frozen lesson sources and ground truth graders judge against, encoded deterministically. */
export function blindAnswerKey(fixture: MigrationFixture): Uint8Array {
  return Buffer.from(`${JSON.stringify(migrationFixtureSchema.parse(fixture), null, 2)}\n`);
}

export function blindPacketDirectory(
  blindDirectory: string,
  packet: { lesson: string; label: string },
) {
  return resolve(blindDirectory, packet.lesson, packet.label);
}

/**
 * Deterministic and conservative: every packet must match its frozen dossier, every accepted case
 * needs at least one grader, critical issues are the union, a concept is taught only if every
 * grader says so, and the scores are the full set of the grader with the lowest five-score mean.
 */
export function mergeBlindQualityReviews(input: {
  freeze: string;
  manifest: unknown;
  acceptedCases: BlindRoundCase[];
  graders: { name: string; review: unknown }[];
}): MigrationQualityReview {
  const manifest = blindPacketManifestSchema.parse(input.manifest);
  if (manifest.freeze !== input.freeze) throw new Error("blind_manifest_freeze_mismatch");
  const key = (lesson: string, label: string) => JSON.stringify([lesson, label]);
  const rounds = new Map(input.acceptedCases.map((entry) => [entry.caseId, entry]));
  const packets = new Map<string, BlindPacketManifest["packets"][number]>();
  const packetCases = new Set<string>();
  const labels = new Set<string>();
  for (const packet of manifest.packets) {
    const packetKey = key(packet.lesson, packet.label);
    if (packets.has(packetKey) || packetCases.has(packet.caseId) || labels.has(packet.label))
      throw new Error("blind_manifest_duplicate_packet");
    const round = rounds.get(packet.caseId);
    if (!round || round.fixtureId !== packet.lesson) throw new Error("blind_manifest_unknown_case");
    if (
      sha256Hex(round.finalModel) !== packet.finalModelSha256 ||
      sha256Hex(round.notes) !== packet.notesSha256 ||
      sha256Hex(round.cards) !== packet.cardsSha256 ||
      sha256Hex(round.answerKey) !== packet.answerKeySha256
    )
      throw new Error("blind_packet_hash_mismatch");
    packets.set(packetKey, packet);
    packetCases.add(packet.caseId);
    labels.add(packet.label);
  }
  if (packetCases.size !== rounds.size) throw new Error("blind_manifest_case_set_mismatch");
  const names = input.graders.map((grader) => grader.name);
  if (!names.length || names.some((name) => !name) || new Set(names).size !== names.length)
    throw new Error("blind_grader_names_invalid");
  const judgments = new Map<string, { grader: string; entry: BlindJudgment }[]>();
  for (const grader of input.graders) {
    const reviewed = new Set<string>();
    for (const entry of blindGraderReviewSchema.parse(grader.review)) {
      const packetKey = key(entry.lesson, entry.label);
      if (!packets.has(packetKey)) throw new Error("blind_review_unknown_label");
      if (reviewed.has(packetKey)) throw new Error("blind_review_duplicate_packet");
      reviewed.add(packetKey);
      judgments.set(packetKey, [
        ...(judgments.get(packetKey) ?? []),
        { grader: grader.name, entry },
      ]);
    }
  }
  const cases = [...rounds.values()].map((round) => {
    const packet = manifest.packets.find((entry) => entry.caseId === round.caseId);
    if (!packet) throw new Error("blind_manifest_case_set_mismatch");
    const graded = judgments.get(key(packet.lesson, packet.label)) ?? [];
    if (!graded.length) throw new Error("blind_case_not_reviewed");
    for (const { entry } of graded) {
      const ids = entry.requiredConcepts.map((concept) => concept.id);
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== round.requiredConceptIds.length ||
        round.requiredConceptIds.some((id) => !ids.includes(id))
      )
        throw new Error("blind_review_requires_all_predeclared_concepts");
    }
    const lowest = [...graded].sort(
      (left, right) =>
        migrationQualityMean(left.entry.scores) - migrationQualityMean(right.entry.scores) ||
        (left.grader < right.grader ? -1 : left.grader > right.grader ? 1 : 0),
    )[0];
    if (!lowest) throw new Error("blind_case_not_reviewed");
    const issues = new Map<string, BlindJudgment["criticalIssues"][number]>();
    for (const { entry } of graded)
      for (const issue of entry.criticalIssues)
        if (!issues.has(canonicalJson(issue))) issues.set(canonicalJson(issue), issue);
    return {
      caseId: round.caseId,
      modelHash: sha256Hex(
        canonicalJson(JSON.parse(Buffer.from(round.finalModel).toString("utf8"))),
      ),
      scores: lowest.entry.scores,
      requiredConcepts: round.requiredConceptIds.map((id) => {
        const concepts = graded.map(({ grader, entry }) => ({
          grader,
          concept: entry.requiredConcepts.find((concept) => concept.id === id),
        }));
        return {
          id,
          adequatelyTaught: concepts.every(({ concept }) => concept?.adequatelyTaught === true),
          evidence: concepts
            .map(({ grader, concept }) => `${grader}: ${concept?.evidence ?? ""}`)
            .join(" | "),
        };
      }),
      criticalIssues: [...issues.values()],
    };
  });
  return migrationQualityReviewSchema.parse({
    freeze: input.freeze,
    reviewer: `Blind merge of ${names.length} grader file(s) (${names.join(", ")}): union of critical issues, every grader must judge each concept taught, scores of the lowest-mean grader`,
    cases,
  });
}

const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

/**
 * The accepted cases of a frozen round. The captured plan must still hash to its freeze, and the
 * round state and answer keys must belong to that freeze.
 */
export async function readFrozenBlindRound(directory: string, approvedFreeze?: string) {
  const planFile = assertMigrationPlanFrozen(await json(resolve(directory, "dry-run-plan.json")));
  const plan = z.object({ freeze: sha256, fixturesHash: z.string() }).parse(planFile);
  if (approvedFreeze !== undefined)
    assert.equal(plan.freeze, approvedFreeze, "The round plan has another freeze");
  const state = migrationRoundStateSchema.parse(await json(resolve(directory, "state.json")));
  assert.equal(state.freeze, plan.freeze, "The round state has another freeze");
  const captured = z
    .object({ cases: z.array(migrationFixtureSchema) })
    .parse(await json(resolve(directory, "fixtures-and-ground-truth.json")));
  assert.equal(
    sha256Hex(canonicalJson(captured.cases)),
    plan.fixturesHash,
    "Captured answer keys differ from the frozen plan",
  );
  const acceptedCases: BlindRoundCase[] = await Promise.all(
    state.results
      .filter((result) => result.finalLocalPass === true)
      .map(async (result) => {
        const caseId = z.string().parse(result.caseId);
        const fixtureId = z.string().parse(result.fixtureId);
        const fixture = captured.cases.find((entry) => entry.id === fixtureId);
        assert.ok(fixture, "Unknown captured fixture");
        const dossier = resolve(directory, "dossiers", caseId);
        return {
          caseId,
          fixtureId,
          requiredConceptIds: z.array(z.string()).parse(fixture.expected.requiredConceptIds),
          finalModel: await readFile(resolve(dossier, "final-model.json")),
          notes: await readFile(resolve(dossier, "notes.html")),
          cards: await readFile(resolve(dossier, "cards.json")),
          answerKey: blindAnswerKey(fixture),
        };
      }),
  );
  return { freeze: plan.freeze, plan: planFile, fixtures: captured.cases, acceptedCases };
}

/** Graders saw the blind folder: its bytes must still equal the manifest. */
export async function verifyBlindPacketFolder(blindDirectory: string, rawManifest: unknown) {
  const manifest = blindPacketManifestSchema.parse(rawManifest);
  for (const packet of manifest.packets) {
    const folder = blindPacketDirectory(blindDirectory, packet);
    const expected = {
      finalModel: packet.finalModelSha256,
      notes: packet.notesSha256,
      cards: packet.cardsSha256,
      answerKey: packet.answerKeySha256,
    };
    for (const [name, file] of Object.entries(blindPacketFiles) as [
      keyof typeof blindPacketFiles,
      string,
    ][])
      if (sha256Hex(await readFile(resolve(folder, file))) !== expected[name])
        throw new Error("blind_folder_differs_from_manifest");
  }
}

function cliOption(argv: string[], name: string) {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`Missing ${name} value`);
  return value;
}
const cliOptions = (argv: string[], name: string) =>
  argv.flatMap((value, index) => {
    if (value !== name) return [];
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing ${name} value`);
    return [next];
  });

// Offline only: reads a frozen round, a packet manifest and grader files; never calls a provider.
async function main(argv: string[]) {
  const out = cliOption(argv, "--out");
  const freeze = cliOption(argv, "--freeze");
  const manifestPath = cliOption(argv, "--manifest");
  const outputPath = cliOption(argv, "--output");
  const blindDirectory = cliOption(argv, "--blind-dir");
  const graderPaths = cliOptions(argv, "--grader");
  assert.ok(
    out && freeze && manifestPath && outputPath && graderPaths.length,
    "Usage: --out <round> --freeze <freeze> --manifest <file> --grader <file>... --output <file> [--blind-dir <folder>]",
  );
  const round = await readFrozenBlindRound(resolve(out), freeze);
  const manifest = await json(resolve(manifestPath));
  if (blindDirectory) await verifyBlindPacketFolder(resolve(blindDirectory), manifest);
  const graders = await Promise.all(
    graderPaths.map(async (path) => ({
      name: basename(path, extname(path)),
      review: await json(resolve(path)),
    })),
  );
  const merged = mergeBlindQualityReviews({
    freeze: round.freeze,
    manifest,
    acceptedCases: round.acceptedCases,
    graders,
  });
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(resolve(outputPath), `${JSON.stringify(merged, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ merged: resolve(outputPath), cases: merged.cases.length, graders: graders.length })}\n`,
  );
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main(process.argv);
