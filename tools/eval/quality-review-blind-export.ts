import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256Hex } from "../../packages/core/src/plt";
import type { MigrationFixture } from "./haiku55-migration-fixtures";
import { evaluationCandidates } from "./model-comparison-candidates";
import {
  type BlindPacketManifest,
  type BlindRoundCase,
  blindPacketDirectory,
  blindPacketFiles,
  blindPacketManifestSchema,
  readFrozenBlindRound,
  verifyBlindPacketFolder,
} from "./quality-review-blind-merge";

/** A, B, ... Z, then AA, AB, ...: the manifest accepts one or two capital letters. */
export function blindPacketLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 26 * 27)
    throw new Error("blind_label_out_of_range");
  const letter = (value: number) => String.fromCharCode(65 + value);
  return index < 26 ? letter(index) : `${letter(Math.floor(index / 26) - 1)}${letter(index % 26)}`;
}

/**
 * Every model, vendor, model family, candidate id and router a grader could recognise. The plan's
 * own model and candidate are always included, so an unlisted candidate is never missed.
 */
export function blindForbiddenNames(plan: Record<string, unknown>): string[] {
  const models = new Set<string>(
    Object.values(evaluationCandidates).map((candidate) => candidate.model),
  );
  const candidateIds = new Set(Object.keys(evaluationCandidates));
  if (typeof plan.model === "string") models.add(plan.model);
  for (const block of [plan.comparison, plan.acceptanceCandidate]) {
    const id =
      block && typeof block === "object" && "candidateId" in block ? block.candidateId : undefined;
    if (typeof id === "string") candidateIds.add(id);
  }
  const names = new Set(["openrouter", ...candidateIds]);
  for (const model of models) {
    const [vendor, slug] = model.split("/");
    for (const name of [model, vendor, slug, slug?.split("-")[0]])
      if (name && name.length >= 3) names.add(name.toLowerCase());
  }
  return [...names].sort();
}

/** A packet that names a model, vendor or router is not blind; nothing is written. */
export function assertBlindPacketClean(
  files: { path: string; bytes: Uint8Array }[],
  forbiddenNames: string[],
) {
  const escapePattern = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const { path, bytes } of files) {
    const text = Buffer.from(bytes).toString("utf8");
    for (const name of forbiddenNames)
      if (
        new RegExp(`(?<![\\p{L}\\p{N}])${escapePattern(name)}(?![\\p{L}\\p{N}])`, "iu").test(text)
      )
        throw new Error(`blind_packet_names_model_or_provider: ${path}`);
  }
}

export type BlindPacket = {
  lesson: string;
  label: string;
  caseId: string;
  files: Record<(typeof blindPacketFiles)[keyof typeof blindPacketFiles], Uint8Array>;
};

/**
 * Shuffles the accepted cases into letter-labelled packets of exactly four files and builds the
 * manifest that maps each lesson + label back to its frozen case. `random(n)` returns 0..n-1.
 */
export function buildBlindPackets(input: {
  freeze: string;
  acceptedCases: BlindRoundCase[];
  fixtures: MigrationFixture[];
  forbiddenNames: string[];
  random: (upperExclusive: number) => number;
}): { packets: BlindPacket[]; manifest: BlindPacketManifest } {
  if (!input.acceptedCases.length) throw new Error("blind_export_has_no_accepted_case");
  const order = input.acceptedCases.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = input.random(index + 1);
    if (!Number.isInteger(swap) || swap < 0 || swap > index)
      throw new Error("blind_shuffle_out_of_range");
    [order[index], order[swap]] = [order[swap] as number, order[index] as number];
  }
  const labels = new Map(
    order.map((caseIndex, position) => [caseIndex, blindPacketLabel(position)]),
  );
  const packets = input.acceptedCases.map((round, index): BlindPacket => {
    if (!input.fixtures.some((fixture) => fixture.id === round.fixtureId))
      throw new Error("blind_export_unknown_fixture");
    const label = labels.get(index);
    if (!label) throw new Error("blind_shuffle_out_of_range");
    return {
      lesson: round.fixtureId,
      label,
      caseId: round.caseId,
      files: {
        [blindPacketFiles.finalModel]: round.finalModel,
        [blindPacketFiles.notes]: round.notes,
        [blindPacketFiles.cards]: round.cards,
        [blindPacketFiles.answerKey]: round.answerKey,
      } as BlindPacket["files"],
    };
  });
  assertBlindPacketClean(
    packets.flatMap((packet) =>
      Object.entries(packet.files).map(([file, bytes]) => ({
        path: `${packet.lesson}/${packet.label}/${file}`,
        bytes,
      })),
    ),
    input.forbiddenNames,
  );
  const manifest = blindPacketManifestSchema.parse({
    version: 1,
    freeze: input.freeze,
    packets: packets
      .map((packet) => ({
        lesson: packet.lesson,
        label: packet.label,
        caseId: packet.caseId,
        finalModelSha256: sha256Hex(packet.files[blindPacketFiles.finalModel]),
        notesSha256: sha256Hex(packet.files[blindPacketFiles.notes]),
        cardsSha256: sha256Hex(packet.files[blindPacketFiles.cards]),
        answerKeySha256: sha256Hex(packet.files[blindPacketFiles.answerKey]),
      }))
      .sort((left, right) => (left.label < right.label ? -1 : 1)),
  });
  return { packets, manifest };
}

/** The manifest de-anonymises the packets, so it never lives inside the folder graders get. */
export function assertManifestOutsideBlindFolder(blindDirectory: string, manifestPath: string) {
  const inside = relative(resolve(blindDirectory), resolve(manifestPath));
  if (!inside || (!inside.startsWith("..") && !isAbsolute(inside)))
    throw new Error("blind_manifest_inside_blind_folder");
}

function cliOption(argv: string[], name: string) {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`Missing ${name} value`);
  return value;
}

/**
 * Offline only: copies frozen dossier output into a fresh blind folder and writes the manifest
 * outside it; never calls a provider.
 */
export async function exportBlindQualityPackets(input: {
  out: string;
  blindDirectory: string;
  manifestPath: string;
  random?: (upperExclusive: number) => number;
}): Promise<BlindPacketManifest> {
  const blindDirectory = resolve(input.blindDirectory);
  const manifestPath = resolve(input.manifestPath);
  assertManifestOutsideBlindFolder(blindDirectory, manifestPath);
  const round = await readFrozenBlindRound(resolve(input.out));
  const { packets, manifest } = buildBlindPackets({
    freeze: round.freeze,
    acceptedCases: round.acceptedCases,
    fixtures: round.fixtures,
    forbiddenNames: blindForbiddenNames(round.plan),
    random: input.random ?? ((upperExclusive) => randomInt(upperExclusive)),
  });
  // A fresh folder only: stale packets from another round can never reach a grader.
  await mkdir(dirname(blindDirectory), { recursive: true });
  await mkdir(blindDirectory);
  for (const packet of packets) {
    const folder = blindPacketDirectory(blindDirectory, packet);
    await mkdir(folder, { recursive: true });
    for (const [file, bytes] of Object.entries(packet.files))
      await writeFile(resolve(folder, file), bytes, { flag: "wx" });
  }
  await verifyBlindPacketFolder(blindDirectory, manifest);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}
`,
    { flag: "wx" },
  );
  return manifest;
}

async function main(argv: string[]) {
  const out = cliOption(argv, "--out");
  const blindDirectory = cliOption(argv, "--blind-dir");
  const manifestPath = cliOption(argv, "--manifest");
  assert.ok(
    out && blindDirectory && manifestPath,
    "Usage: --out <frozen round> --blind-dir <new folder> --manifest <file outside it>",
  );
  const manifest = await exportBlindQualityPackets({ out, blindDirectory, manifestPath });
  process.stdout.write(
    `${JSON.stringify({ blindDirectory: resolve(blindDirectory), manifest: resolve(manifestPath), packets: manifest.packets.length })}
`,
  );
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main(process.argv);
