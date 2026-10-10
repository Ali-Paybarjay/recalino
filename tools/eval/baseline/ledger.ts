import { mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { z } from "../../../packages/core/node_modules/zod";
import { canonicalJson, sha256Hex } from "../../../packages/core/src/plt";

/**
 * The shared evaluation ledger protocol, replicated exactly from
 * tools/eval/haiku55-migration-guards.ts of codex/haiku55-migration (commit cde604b). Only the
 * import paths differ and the cumulative cap is a local constant instead of
 * migrationControls.cumulativeHardUsd; ledger.test.ts proves both implementations agree on the
 * same file and share its lock.
 */
export const migrationCumulativeHardUsd = 5.0;

export const migrationRequestSchema = z.strictObject({
  id: z.string(),
  caseId: z.string(),
  stage: z.string(),
  state: z.enum(["started", "completed", "known_rejection", "uncertain"]),
  reserveUsd: z.number().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
});
export type MigrationRequest = z.infer<typeof migrationRequestSchema>;

/** Missing state is safe; unreadable or corrupt recorded state must never reset paid history. */
export async function readMigrationRecordedJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
}

/**
 * A captured dry-run plan must still hash to its own freeze, so nothing it records (fixture set,
 * candidate, transport, date) can be edited after approval.
 */
export function assertMigrationPlanFrozen(planFile: unknown) {
  const plan = z.record(z.string(), z.unknown()).parse(planFile);
  const { freeze } = z.object({ freeze: z.string().regex(/^[a-f0-9]{64}$/) }).parse(plan);
  const frozen = Object.fromEntries(
    Object.entries(plan).filter(([name]) => name !== "freeze" && name !== "paidCalls"),
  );
  if (sha256Hex(canonicalJson(frozen)) !== freeze)
    throw new Error("The captured plan differs from its freeze");
  return { ...plan, freeze };
}

export const migrationRoundStateSchema = z.strictObject({
  freeze: z.string(),
  spentUsd: z.number().nonnegative(),
  stopped: z.boolean(),
  stopReason: z.string().optional(),
  requests: z.array(migrationRequestSchema),
  results: z.array(z.record(z.string(), z.unknown())),
});
export type MigrationRoundState = z.infer<typeof migrationRoundStateSchema>;

/** Spend that predates the cross-round ledger: every earlier migration round and diagnostic. */
export const migrationUnledgeredPriorUsd = 0.164853;
export const migrationLedgerSchema = z.strictObject({
  version: z.literal(1),
  priorUnledgeredUsd: z.number().nonnegative(),
  rounds: z.array(
    z.strictObject({
      freeze: z.string().regex(/^[a-f0-9]{64}$/),
      directory: z.string().min(1),
      fixtureSet: z.string().min(1),
      spentUsd: z.number().nonnegative(),
      // Reserve of this round's dispatch in progress; parallel rounds count it before dispatch.
      inFlightUsd: z.number().nonnegative().optional(),
      status: z.enum(["running", "stopped", "completed"]),
    }),
  ),
});
export type MigrationLedger = z.infer<typeof migrationLedgerSchema>;

/**
 * One frozen candidate gets one live round. A fresh output directory can neither repeat an
 * evaluated freeze nor reset the cumulative migration budget.
 */
export function migrationLedgerRound(
  ledger: MigrationLedger,
  freeze: string,
  directory: string,
  fixtureSet: string,
): MigrationLedger["rounds"][number] {
  const existing = ledger.rounds.find((round) => round.freeze === freeze);
  if (existing && existing.directory !== directory)
    throw new Error("freeze_already_evaluated_in_another_directory");
  if (existing && existing.fixtureSet !== fixtureSet) throw new Error("fixture_set_changed");
  if (!existing && ledger.rounds.some((round) => round.directory === directory))
    throw new Error("directory_belongs_to_another_freeze");
  if (existing) return existing;
  const round = { freeze, directory, fixtureSet, spentUsd: 0, status: "running" as const };
  ledger.rounds.push(round);
  return round;
}

export function assertMigrationCumulativeBudget(ledger: MigrationLedger, reserveUsd: number) {
  const spent =
    ledger.priorUnledgeredUsd +
    ledger.rounds.reduce((total, round) => total + round.spentUsd + (round.inFlightUsd ?? 0), 0);
  if (!Number.isFinite(spent) || spent + reserveUsd > migrationCumulativeHardUsd)
    throw new Error("cumulative_budget_before_dispatch");
}

/**
 * Live dispatch needs the shared ledger that already holds every earlier QA round; it is ignored by
 * git and lives in one worktree. A missing file would silently restart the cumulative cap, so only
 * an explicit initialisation may create one, and only where none exists yet.
 */
export async function assertMigrationLedgerAvailable(path: string, initialize: boolean) {
  const recorded = await readMigrationRecordedJson(path);
  if (recorded === undefined && !initialize) throw new Error("ledger_missing_pass_shared_ledger");
  if (recorded !== undefined && initialize) throw new Error("ledger_exists_drop_initialize_flag");
  if (recorded !== undefined) migrationLedgerSchema.parse(recorded);
}

/**
 * Serialises every ledger read-modify-write across concurrent rounds with an exclusive lock
 * directory, so parallel rounds can neither lose spend nor jointly exceed the cumulative cap.
 */
export async function withMigrationLedger<T>(
  path: string,
  update: (ledger: MigrationLedger) => T,
): Promise<T> {
  const lock = `${path}.lock`;
  for (let attempt = 0; ; attempt++) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
        throw error;
      if (attempt >= 600) throw new Error("ledger_lock_timeout");
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  try {
    const ledger = migrationLedgerSchema.parse(
      (await readMigrationRecordedJson(path)) ?? {
        version: 1,
        priorUnledgeredUsd: migrationUnledgeredPriorUsd,
        rounds: [],
      },
    );
    const result = update(ledger);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(ledger, null, 2));
    await rename(temporary, path);
    return result;
  } finally {
    await rmdir(lock);
  }
}
