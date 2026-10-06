import { randomUUID } from "node:crypto";
import type { Selectable } from "kysely";
import { z } from "zod";
import {
  getAccountState,
  listTeachingPreferences,
  lockAccount,
  lockAccountForCleanup,
} from "../acc";
import { type AiProvider, requireProvider } from "../aip";
import type { Database, DB, Tx } from "../db";
import { getLatestVersion, tombstoneKnowledge } from "../lkm";
import { assertSessionOwner, getSession } from "../org";
import {
  assertOwner,
  cancelJob,
  canonicalJson,
  deleteObject,
  enqueueJob,
  errors,
  type JobDefinition,
  type LearnerContext,
  type ObjectStore,
  readPltSettings,
  sha256Hex,
} from "../plt";
import {
  type Amounts,
  amounts,
  amountsSchema,
  emptyAmounts,
  equivalentPages,
  reserveAllowance,
  selectedSeconds,
  settleAllowance,
} from "../quota";
import { selectSourceSnapshot } from "../src";
import {
  createRunSchema,
  type RunSnapshot,
  type RunState,
  runSettingsSchema,
  sourceSnapshotSchema,
} from "./contracts";
import { processingSelectionFingerprint } from "./selection";

export interface ProcessingRun {
  id: string;
  sessionId: string;
  state: RunState;
  reservationId: string;
  sourcesVersion: number;
  selectionFingerprint?: string;
  lastError: string | null;
  outputVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}
export function runView(row: Selectable<DB["proc.processing_run"]>): ProcessingRun {
  const snapshot = sourceSnapshotSchema.safeParse(row.input_snapshot);
  return {
    id: row.id,
    sessionId: row.session_id,
    state: row.state as RunState,
    reservationId: row.reservation_id,
    sourcesVersion: row.sources_version,
    ...(snapshot.success
      ? { selectionFingerprint: processingSelectionFingerprint(snapshot.data) }
      : {}),
    lastError: row.last_error,
    outputVersionId: row.output_version_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
export async function ownedRun(db: Database | Tx, ctx: LearnerContext, id: string, lock = false) {
  const row = await db
    .selectFrom("proc.processing_run")
    .selectAll()
    .where("id", "=", id)
    .$if(lock, (qb) => qb.forUpdate())
    .executeTakeFirst();
  assertOwner(row ? { ownerId: row.user_id } : undefined, ctx);
  if (!row) throw errors.notFound();
  return row;
}
export async function getRun(
  db: Database | Tx,
  ctx: LearnerContext,
  id: string,
): Promise<ProcessingRun> {
  const row = await ownedRun(db, ctx, id);
  await getSession(db, ctx, row.session_id);
  return runView(row);
}
export async function listRuns(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
): Promise<ProcessingRun[]> {
  await getSession(db, ctx, sessionId);
  const rows = await db
    .selectFrom("proc.processing_run")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("kind", "=", "class")
    .orderBy("created_at", "desc")
    .limit(50)
    .execute();
  return rows.map(runView);
}

/** Processing owns historical run provenance; sources own selection and cache validity. */
export function selectProcessingSourceSnapshot(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  confirmedSnapshot?: Parameters<typeof selectSourceSnapshot>[3],
) {
  return selectSourceSnapshot(db, ctx, sessionId, confirmedSnapshot, {
    async legacyAudioRanges(originKey, sourceId) {
      const runId = z.uuid().safeParse(originKey.split(":")[1]);
      if (!runId.success) return undefined;
      const priorRun = await db
        .selectFrom("proc.processing_run")
        .select("input_snapshot")
        .where("id", "=", runId.data)
        .where("user_id", "=", ctx.userId)
        .executeTakeFirst();
      const prior = sourceSnapshotSchema.safeParse(priorRun?.input_snapshot);
      return prior.success
        ? prior.data.sources.find((source) => source.sourceId === sourceId)?.ranges
        : undefined;
    },
  });
}
export function estimateRunAmounts(
  snapshot: RunSnapshot,
  charactersPerPage: number,
  regeneration: boolean,
): Amounts {
  const used = emptyAmounts();
  for (const source of snapshot.sources) {
    if (source.kind === "audio")
      used.audio += source.ranges.length
        ? selectedSeconds(
            source.ranges.map((range) => ({ start: range.start / 1000, end: range.end / 1000 })),
          )
        : Math.ceil((source.durationMs ?? 0) / 1000);
    else if (source.kind === "pdf")
      used.document += source.ranges.length
        ? source.ranges.reduce((total, range) => total + range.end - range.start + 1, 0)
        : (source.pageCount ?? 0);
    else if (source.kind === "image") used.document += 1;
    else
      used.document += equivalentPages(
        source.blocks.map((block) => block.text).join("\n"),
        charactersPerPage,
      );
  }
  used.regeneration = regeneration ? 1 : 0;
  return amountsSchema.parse(used);
}

/** Known selected text is bounded before confirmation; OCR/transcription output is bounded separately. */
export function assertKnownSourceInputBound(
  snapshot: RunSnapshot,
  maxInputCharacters: number,
): void {
  const sources = snapshot.sources.map(({ objectId: _objectId, sha256: _sha256, ...source }) => {
    const units = source.ranges.length
      ? source.units.filter((unit) =>
          source.ranges.some((range) =>
            unit.kind === "page"
              ? unit.start >= range.start && unit.start <= range.end
              : unit.kind === "time"
                ? unit.start >= range.start && (unit.end ?? unit.start) <= range.end
                : true,
          ),
        )
      : source.units;
    return {
      ...source,
      units,
      blocks: source.blocks.filter((block) => units.some((unit) => unit.id === block.unitId)),
    };
  });
  if (
    JSON.stringify({ explanationLanguage: "", sources, missingSourceIds: [] }).length >
    maxInputCharacters
  )
    throw errors.validationFailed({ sources: ["selected_text_too_large"] });
}
/** AC-13: reservation, immutable inputs, run and job share a single commit. */
export async function createProcessingRun(
  db: Database,
  ctx: LearnerContext,
  raw: unknown,
  options: {
    provider?: AiProvider;
    job: JobDefinition<{ runId: string; userId: string }>;
    now?: Date;
  },
): Promise<ProcessingRun> {
  const input = createRunSchema.parse(raw);
  const provider = requireProvider(options.provider);
  const hash = sha256Hex(canonicalJson(input));
  const now = options.now ?? new Date();
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const session = await assertSessionOwner(tx, ctx, input.sessionId);
    const previous = await tx
      .selectFrom("proc.processing_run")
      .selectAll()
      .where("user_id", "=", ctx.userId)
      .where("operation_key", "=", input.operationKey)
      .executeTakeFirst();
    if (previous) {
      if (previous.request_hash !== hash) throw errors.idempotencyMismatch();
      return runView(previous);
    }
    const account = await getAccountState(tx, ctx.userId);
    if (!account?.setupComplete || account.pending.terms)
      throw errors.validationFailed({ profile: ["acceptance_required"] });
    const active = await tx
      .selectFrom("proc.processing_run")
      .select("id")
      .where("session_id", "=", session.id)
      .where("state", "in", ["awaiting_upload", "queued", "processing"])
      .executeTakeFirst();
    if (active) throw errors.conflict();
    const unresolved = await tx
      .selectFrom("proc.provider_attempt")
      .innerJoin("proc.processing_run", "proc.processing_run.id", "proc.provider_attempt.run_id")
      .select("proc.provider_attempt.id")
      .where("proc.provider_attempt.user_id", "=", ctx.userId)
      .where("proc.processing_run.session_id", "=", session.id)
      .where("proc.processing_run.kind", "=", "class")
      .where("proc.provider_attempt.state", "in", ["started", "uncertain"])
      .executeTakeFirst();
    if (unresolved) throw errors.validationFailed({ retry: ["provider_outcome_unresolved"] });
    const snapshot = sourceSnapshotSchema.parse(
      await selectProcessingSourceSnapshot(tx, ctx, session.id),
    );
    assertKnownSourceInputBound(snapshot, provider.settings.maxInputCharacters);
    if (
      (input.expectedFingerprint !== undefined &&
        input.expectedFingerprint !== snapshot.fingerprint) ||
      (input.expectedSourcesVersion !== undefined &&
        input.expectedSourcesVersion !== snapshot.sourcesVersion)
    )
      throw errors.validationFailed({ sources: ["changed_after_estimate"] });
    const id = randomUUID();
    const requested = estimateRunAmounts(
      snapshot,
      provider.settings.charactersPerPage,
      (await getLatestVersion(tx, ctx, session.id)) !== null,
    );
    const reservation = await reserveAllowance(tx, ctx, `processing:${id}`, requested, now);
    const awaiting = snapshot.sources.some(
      (source) => source.kind === "audio" && !source.contentVersionId && !source.objectId,
    );
    const settings = runSettingsSchema.parse({
      provider: provider.settings,
      explanationLanguage:
        account.profile.explanationLanguage === "english" ? "en" : account.profile.firstLanguage,
      profileVersion: account.profile.version,
      teachingPreferences: {
        shorterExamples: (await listTeachingPreferences(tx, ctx)).some(
          (preference) =>
            preference.key === "shorter_examples" &&
            preference.origin === "explicit" &&
            preference.value === true,
        ),
      },
    });
    const jobId = awaiting
      ? null
      : await enqueueJob(tx, options.job, {
          payload: { runId: id, userId: ctx.userId },
          singletonKey: id,
          now,
          defaults: readPltSettings().jobs,
        });
    const row = await tx
      .insertInto("proc.processing_run")
      .values({
        id,
        user_id: ctx.userId,
        session_id: session.id,
        operation_key: input.operationKey,
        request_hash: hash,
        sources_version: snapshot.sourcesVersion,
        source_fingerprint: snapshot.fingerprint,
        input_snapshot: JSON.stringify(snapshot),
        settings: JSON.stringify(settings),
        requested_amounts: JSON.stringify(requested),
        reservation_id: reservation.id,
        state: awaiting ? "awaiting_upload" : "queued",
        job_id: jobId,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return runView(row);
  });
}
export async function activateProcessingRun(
  db: Database,
  ctx: LearnerContext,
  id: string,
  job: JobDefinition<{ runId: string; userId: string }>,
  now = new Date(),
): Promise<ProcessingRun> {
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const run = await ownedRun(tx, ctx, id, true);
    await assertSessionOwner(tx, ctx, run.session_id);
    if (run.state !== "awaiting_upload") return runView(run);
    const original = sourceSnapshotSchema.parse(run.input_snapshot);
    const current = sourceSnapshotSchema.parse(
      await selectProcessingSourceSnapshot(tx, ctx, run.session_id, original),
    );
    const stable = (snapshot: RunSnapshot) =>
      snapshot.sources.map((source) => ({
        sourceId: source.sourceId,
        kind: source.kind,
        sha256: source.sha256,
        contentVersionId: source.contentVersionId,
        ranges: source.ranges,
        captureAnchor: source.captureAnchor,
      }));
    if (canonicalJson(stable(current)) !== canonicalJson(stable(original)))
      throw errors.validationFailed({ sources: ["changed_after_confirmation"] });
    for (const source of current.sources) {
      const confirmed = original.sources.find((item) => item.sourceId === source.sourceId);
      if (
        source.kind === "audio" &&
        (!confirmed?.durationMs ||
          !source.durationMs ||
          source.ranges.some((range) => range.end > (source.durationMs ?? 0)))
      )
        throw errors.validationFailed({ audio: ["new_confirmation_required"] });
    }
    const held = amountsSchema.parse(run.requested_amounts);
    const actual = estimateRunAmounts(
      current,
      runSettingsSchema.parse(run.settings).provider.charactersPerPage,
      held.regeneration > 0,
    );
    // Decoding can add codec padding milliseconds. The confirmed selection must stay
    // valid, and its measured, rounded usage must still fit the original reservation.
    if (
      Object.keys(actual).some(
        (dimension) => actual[dimension as keyof Amounts] > held[dimension as keyof Amounts],
      )
    )
      throw errors.validationFailed({ quota: ["new_confirmation_required"] });
    if (
      current.sources.some(
        (source) => source.kind === "audio" && !source.contentVersionId && !source.objectId,
      )
    )
      throw errors.validationFailed({ upload: ["incomplete"] });
    const jobId = await enqueueJob(tx, job, {
      payload: { runId: id, userId: ctx.userId },
      singletonKey: id,
      now,
      defaults: readPltSettings().jobs,
    });
    const row = await tx
      .updateTable("proc.processing_run")
      .set({
        state: "queued",
        input_snapshot: JSON.stringify({
          ...current,
          fingerprint: original.fingerprint,
          sourcesVersion: original.sourcesVersion,
        }),
        job_id: jobId,
        updated_at: now,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return runView(row);
  });
}
export async function cancelRun(
  db: Database,
  ctx: LearnerContext,
  id: string,
  now = new Date(),
): Promise<ProcessingRun> {
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const run = await ownedRun(tx, ctx, id, true);
    await assertSessionOwner(tx, ctx, run.session_id);
    if (["ready", "partial_ready", "cancelled", "failed", "needs_input"].includes(run.state))
      return runView(run);
    if (run.job_id) await cancelJob(tx, run.job_id, now);
    await settleAllowance(tx, ctx, run.reservation_id, emptyAmounts(), now);
    const row = await tx
      .updateTable("proc.processing_run")
      .set({ state: "cancelled", finished_at: now, updated_at: now })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return runView(row);
  });
}
export async function failAwaitingUploadRun(
  db: Database,
  ctx: LearnerContext,
  id: string,
  code: "audio_upload_rejected" | "new_confirmation_required",
  now = new Date(),
): Promise<ProcessingRun> {
  return db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const run = await ownedRun(tx, ctx, id, true);
    await assertSessionOwner(tx, ctx, run.session_id);
    if (run.state !== "awaiting_upload") return runView(run);
    await settleAllowance(tx, ctx, run.reservation_id, emptyAmounts(), now);
    const row = await tx
      .updateTable("proc.processing_run")
      .set({ state: "needs_input", last_error: code, finished_at: now, updated_at: now })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return runView(row);
  });
}

/** New run/reservation preserves successful source extraction and the old output/edit history. */
export async function retryRun(
  db: Database,
  ctx: LearnerContext,
  id: string,
  operationKey: string,
  options: Parameters<typeof createProcessingRun>[3],
): Promise<ProcessingRun> {
  const prior = await getRun(db, ctx, id);
  if (!["failed", "needs_input", "partial_ready", "cancelled"].includes(prior.state))
    throw errors.conflict();
  const unresolved = await db
    .selectFrom("proc.provider_attempt")
    .select("id")
    .where("run_id", "=", id)
    .where("state", "in", ["started", "uncertain"])
    .executeTakeFirst();
  if (unresolved) throw errors.validationFailed({ retry: ["provider_outcome_unresolved"] });
  return createProcessingRun(db, ctx, { sessionId: prior.sessionId, operationKey }, options);
}
export async function cancelSessionRuns(
  tx: Tx,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  const runs = await tx
    .selectFrom("proc.processing_run")
    .selectAll()
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("state", "in", ["awaiting_upload", "queued", "processing"])
    .forUpdate()
    .execute();
  for (const run of runs) {
    if (run.job_id) await cancelJob(tx, run.job_id, now);
    await settleAllowance(tx, ctx, run.reservation_id, amounts({}), now);
    await tx
      .updateTable("proc.processing_run")
      .set({ state: "cancelled", finished_at: now, updated_at: now })
      .where("id", "=", run.id)
      .execute();
  }
  await tombstoneKnowledge(tx, ctx, sessionId, now);
}

export async function validateAudioUploadRun(
  db: Database | Tx,
  ctx: LearnerContext,
  runId: string,
  sourceId: string,
  reservationId: string,
): Promise<void> {
  const run = await ownedRun(db, ctx, runId);
  await getSession(db, ctx, run.session_id);
  if (
    run.state !== "awaiting_upload" ||
    run.reservation_id !== reservationId ||
    !sourceSnapshotSchema
      .parse(run.input_snapshot)
      .sources.some((source) => source.sourceId === sourceId && source.kind === "audio")
  )
    throw errors.validationFailed({ audio: ["confirmed_processing_required"] });
}

/** Capture identifiers atomically with source deletion. Replacement runs have no marker. */
export async function markSourceProcessingForCleanup(
  tx: Tx,
  ctx: LearnerContext,
  sourceId: string,
  sessionIds: readonly string[],
  now = new Date(),
): Promise<void> {
  if (!sessionIds.length) return;
  const runs = await tx
    .selectFrom("proc.processing_run")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .where("session_id", "in", [...sessionIds])
    .execute();
  if (runs.length)
    await tx
      .insertInto("proc.run_step")
      .values(
        runs.map((run) => ({
          run_id: run.id,
          step: `cleanup:source:${sourceId}`,
          output: "{}",
          completed_at: now,
        })),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
}
async function cleanupProcessingRuns(
  db: Database,
  ctx: LearnerContext,
  runIds: readonly string[],
  options?: { store: ObjectStore; now?: Date },
): Promise<void> {
  if (!runIds.length) return;
  await db.transaction().execute(async (tx) => {
    await lockAccountForCleanup(tx, ctx.userId);
    const rows = await tx
      .selectFrom("proc.processing_run")
      .select(["id", "state"])
      .where("user_id", "=", ctx.userId)
      .where("id", "in", [...runIds])
      .forUpdate()
      .execute();
    if (rows.some((run) => ["queued", "processing", "awaiting_upload"].includes(run.state)))
      throw errors.conflict();
    if (!rows.length) return;
    const ids = rows.map((run) => run.id);
    const temporary = await tx
      .selectFrom("proc.temporary_object")
      .select(["run_id", "object_id"])
      .where("user_id", "=", ctx.userId)
      .where("run_id", "in", ids)
      .where("deleted_at", "is", null)
      .execute();
    if (temporary.length && !options?.store)
      throw errors.validationFailed({ cleanup: ["temporary_storage_adapter_missing"] });
    if (options)
      for (const object of temporary) {
        const now = options.now ?? new Date();
        await deleteObject(tx, options.store, ctx, object.object_id, now);
        await tx
          .updateTable("proc.temporary_object")
          .set({ deleted_at: now })
          .where("run_id", "=", object.run_id)
          .where("object_id", "=", object.object_id)
          .where("user_id", "=", ctx.userId)
          .execute();
      }
    await tx
      .deleteFrom("proc.run_step")
      .where(
        "run_id",
        "in",
        rows.map((run) => run.id),
      )
      .execute();
    await tx
      .updateTable("proc.processing_run")
      .set({ input_snapshot: "{}", settings: "{}", output_version_id: null })
      .where(
        "id",
        "in",
        rows.map((run) => run.id),
      )
      .execute();
  });
}
/** Remove only runs captured by the original source tombstone, including auxiliary text. */
export async function cleanupSourceProcessing(
  db: Database,
  ctx: LearnerContext,
  sourceId: string,
  options?: { store: ObjectStore; now?: Date },
): Promise<void> {
  const rows = await db
    .selectFrom("proc.run_step")
    .innerJoin("proc.processing_run", "proc.processing_run.id", "proc.run_step.run_id")
    .select("proc.run_step.run_id")
    .where("proc.processing_run.user_id", "=", ctx.userId)
    .where("proc.run_step.step", "=", `cleanup:source:${sourceId}`)
    .execute();
  await cleanupProcessingRuns(
    db,
    ctx,
    rows.map((row) => row.run_id),
    options,
  );
}
/** Session/account tombstones prevent replacement runs before this broader cleanup. */
export async function cleanupSessionProcessing(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  options?: { store: ObjectStore; now?: Date },
): Promise<void> {
  const rows = await db
    .selectFrom("proc.processing_run")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .execute();
  await cleanupProcessingRuns(
    db,
    ctx,
    rows.map((row) => row.id),
    options,
  );
}
export async function cleanupAccountProcessing(
  db: Database,
  ctx: LearnerContext,
  options?: { store: ObjectStore; now?: Date },
): Promise<void> {
  const rows = await db
    .selectFrom("proc.processing_run")
    .select("session_id")
    .distinct()
    .where("user_id", "=", ctx.userId)
    .execute();
  for (const row of rows) await cleanupSessionProcessing(db, ctx, row.session_id, options);
}
export async function registerProcessingTemporaryObject(
  db: Database,
  ctx: LearnerContext,
  runId: string,
  objectId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockAccount(tx, ctx.userId);
    const run = await ownedRun(tx, ctx, runId, true);
    await assertSessionOwner(tx, ctx, run.session_id);
    if (!["queued", "processing"].includes(run.state)) throw errors.conflict();
    await tx
      .insertInto("proc.temporary_object")
      .values({ run_id: runId, object_id: objectId, user_id: ctx.userId, created_at: now })
      .onConflict((oc) => oc.doNothing())
      .execute();
  });
}
export async function cancelAccountRuns(
  tx: Tx,
  ctx: LearnerContext,
  now = new Date(),
): Promise<void> {
  const rows = await tx
    .selectFrom("proc.processing_run")
    .select("session_id")
    .distinct()
    .where("user_id", "=", ctx.userId)
    .execute();
  for (const row of rows) await cancelSessionRuns(tx, ctx, row.session_id, now);
}
