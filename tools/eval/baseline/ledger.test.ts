import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as replica from "./ledger";

// The shared ledger's own implementation lives in the haiku55-migration worktree.
const originalPath =
  process.env.RECALINO_HAIKU55_GUARDS ??
  "C:/Users/Ali-PC/.codex/worktrees/haiku55-migration/Recalino/tools/eval/haiku55-migration-guards.ts";
type Implementation = Pick<
  typeof replica,
  | "withMigrationLedger"
  | "migrationLedgerRound"
  | "assertMigrationCumulativeBudget"
  | "migrationUnledgeredPriorUsd"
  | "migrationRoundStateSchema"
>;
const loadOriginal = async (): Promise<Implementation> =>
  (await import(/* @vite-ignore */ pathToFileURL(originalPath).href)) as Implementation;

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const temporaryLedger = async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseline-ledger-"));
  directories.push(directory);
  return join(directory, "ledger.json");
};
const freeze = (letter: string) => letter.repeat(64);

/** One round's whole life: create, reserve in flight, settle, refuse at the cap, finish. */
async function exercise(implementation: Implementation, path: string) {
  const results: unknown[] = [];
  results.push(
    await implementation.withMigrationLedger(
      path,
      (ledger) =>
        implementation.migrationLedgerRound(ledger, freeze("a"), "round-a", "set").spentUsd,
    ),
  );
  await implementation.withMigrationLedger(path, (ledger) => {
    implementation.assertMigrationCumulativeBudget(ledger, 0.07);
    const round = ledger.rounds[0];
    if (round) round.inFlightUsd = 0.07;
  });
  await implementation.withMigrationLedger(path, (ledger) => {
    const round = ledger.rounds[0];
    if (!round) return;
    round.spentUsd = 0.0123;
    round.inFlightUsd = 0;
    round.status = "completed";
  });
  for (const reserve of [1, 4.9])
    results.push(
      await implementation
        .withMigrationLedger(path, (ledger) => {
          implementation.assertMigrationCumulativeBudget(ledger, reserve);
          return "allowed";
        })
        .catch((error: Error) => error.message),
    );
  for (const [round, directory, set] of [
    [freeze("a"), "round-b", "set"],
    [freeze("a"), "round-a", "other"],
    [freeze("b"), "round-a", "set"],
  ] as const)
    results.push(
      await implementation
        .withMigrationLedger(path, (ledger) =>
          implementation.migrationLedgerRound(ledger, round, directory, set),
        )
        .catch((error: Error) => error.message),
    );
  return results;
}

describe("shared ledger protocol", () => {
  it("records spend, in-flight reserves and the cumulative cap", async () => {
    const path = await temporaryLedger();
    expect(await exercise(replica, path)).toEqual([
      0,
      "allowed",
      "cumulative_budget_before_dispatch",
      "freeze_already_evaluated_in_another_directory",
      "fixture_set_changed",
      "directory_belongs_to_another_freeze",
    ]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      priorUnledgeredUsd: replica.migrationUnledgeredPriorUsd,
      rounds: [
        {
          freeze: freeze("a"),
          directory: "round-a",
          fixtureSet: "set",
          spentUsd: 0.0123,
          inFlightUsd: 0,
          status: "completed",
        },
      ],
    });
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it("refuses a corrupt ledger instead of restarting the cumulative cap", async () => {
    const path = await temporaryLedger();
    await writeFile(path, "{");
    await expect(replica.withMigrationLedger(path, () => undefined)).rejects.toThrow();
    await expect(replica.assertMigrationLedgerAvailable(`${path}.missing`, false)).rejects.toThrow(
      "ledger_missing_pass_shared_ledger",
    );
  });

  it.skipIf(!existsSync(originalPath))(
    "agrees byte for byte with the original haiku55 implementation",
    async () => {
      const original = await loadOriginal();
      const [left, right] = [await temporaryLedger(), await temporaryLedger()];
      expect(await exercise(replica, left)).toEqual(await exercise(original, right));
      expect(await readFile(left, "utf8")).toBe(await readFile(right, "utf8"));
      expect(replica.migrationUnledgeredPriorUsd).toBe(original.migrationUnledgeredPriorUsd);
      const state = { freeze: "f", spentUsd: 0, stopped: false, requests: [], results: [] };
      expect(replica.migrationRoundStateSchema.parse(state)).toEqual(
        original.migrationRoundStateSchema.parse(state),
      );
    },
  );

  it.skipIf(!existsSync(originalPath))(
    "shares the original's lock, so concurrent writers from both never lose spend",
    async () => {
      const original = await loadOriginal();
      const path = await temporaryLedger();
      await replica.withMigrationLedger(path, (ledger) =>
        replica.migrationLedgerRound(ledger, freeze("c"), "round-c", "set"),
      );
      await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          (index % 2 ? original : replica).withMigrationLedger(path, (ledger) => {
            const round = ledger.rounds[0];
            if (round) round.spentUsd += 0.01;
          }),
        ),
      );
      const ledger = JSON.parse(await readFile(path, "utf8"));
      expect(ledger.rounds[0].spentUsd).toBeCloseTo(0.24, 10);
    },
  );
});
