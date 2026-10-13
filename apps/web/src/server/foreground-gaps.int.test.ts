import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { readRunTimes, stageDurations } from "@recalino/core/ops";
import { MemoryObjectStore } from "@recalino/core/plt";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOCAL_APP_DATABASE_URL } from "../../../../packages/core/test/local-db";
import { type WorkspaceRequestError, workspaceRequest } from "../ui/workspace/api";
import {
  auditAudio,
  auditClass,
  auditConfirmedRun,
  auditFetch,
  auditLearner,
  auditProvider,
  auditSource,
} from "./audio-audit-support";
import { getProcessingDefinition } from "./processing-jobs";

/**
 * NFR-07 (owner decision 2026-10-13, D71): the learning route stores the intervals a device
 * reports its page hidden, the operator report counts them inside the run, and the write is
 * owned, bounded and idempotent.
 */
const synthetic = vi.hoisted(() => ({ store: null as MemoryObjectStore | null }));
vi.mock("./storage", () => ({ getObjectStore: () => synthetic.store }));
vi.mock("./jobs", () => ({
  PROCESSING_WAKE: { budgetSeconds: 600, functionSeconds: 800 },
  runJobsSoon: () => {},
}));
vi.mock("./ai", () => ({ getAiProvider: () => auditProvider() }));

const db = createDatabase(LOCAL_APP_DATABASE_URL, { maxConnections: 4 });
afterAll(() => db.destroy());
let currentUser: string | null = null;
beforeEach(() => {
  synthetic.store = new MemoryObjectStore();
  vi.stubGlobal(
    "fetch",
    auditFetch(db, () => currentUser),
  );
});
afterEach(() => vi.unstubAllGlobals());

const gap = (sessionId: string, hiddenAt: Date, visibleAt: Date) =>
  workspaceRequest<{ recorded: boolean }>(`/api/classes/${sessionId}/learning`, "POST", {
    action: "foreground_gap",
    hiddenAt: hiddenAt.toISOString(),
    visibleAt: visibleAt.toISOString(),
  });
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error as WorkspaceRequestError,
  );

it("stores a reported hidden interval once, owned by the learner, and reports it inside the run", async () => {
  const learner = await auditLearner(db);
  currentUser = learner.userId;
  const processing = getProcessingDefinition();
  if (!processing) throw new Error("processing unavailable");
  const since = new Date();
  await auditSource(db, learner.ctx, learner.session.id, auditAudio(3));
  const run = await auditConfirmedRun(db, learner.ctx, learner.session.id, {
    provider: auditProvider(),
    job: processing,
  });
  const created = await db
    .selectFrom("proc.processing_run")
    .select("created_at")
    .where("id", "=", run.id)
    .executeTakeFirstOrThrow();
  const hiddenAt = new Date(created.created_at.getTime() - 20_000);
  const visibleAt = new Date(created.created_at.getTime() + 40_000);
  expect(await gap(learner.session.id, hiddenAt, visibleAt)).toEqual({ recorded: true });
  // The same interval again changes nothing (PRD-PROC-03).
  expect(await gap(learner.session.id, hiddenAt, visibleAt)).toEqual({ recorded: false });
  const rows = await db
    .selectFrom("proc.foreground_gap")
    .select(["hidden_at", "visible_at"])
    .where("session_id", "=", learner.session.id)
    .execute();
  expect(rows).toHaveLength(1);
  const times = (await readRunTimes(db, since, new Date(Date.now() + 60_000))).find(
    (candidate) => candidate.runId === run.id,
  );
  if (!times) throw new Error("run missing from the report");
  expect(times.foregroundGaps).toEqual([{ hiddenAt, visibleAt }]);
  // Only the 40 s after the run was created count; the run is still open.
  expect(stageDurations(times).device_hidden).toBe(40);
  // Another learner cannot report against this class.
  const other = await auditLearner(db);
  currentUser = other.userId;
  expect(await failure(gap(learner.session.id, hiddenAt, visibleAt))).toMatchObject({
    status: 404,
  });
  expect(await gap(other.session.id, hiddenAt, visibleAt)).toEqual({ recorded: true });
  // A deleted or unknown class is refused the same way.
  expect(await failure(gap(randomUUID(), hiddenAt, visibleAt))).toMatchObject({ status: 404 });
});

it("refuses intervals outside the bounds a device can honestly report", async () => {
  const learner = await auditLearner(db);
  currentUser = learner.userId;
  const klass = await auditClass(db, learner.ctx);
  const now = Date.now();
  const day = 86_400_000;
  const outOfRange: [Date, Date][] = [
    [new Date(now), new Date(now - 1000)],
    [new Date(now - 8 * day), new Date(now - 7 * day - 1000)],
    [new Date(now - 10 * day), new Date(now)],
    [new Date(now), new Date(now + 10 * 60_000)],
  ];
  for (const [hiddenAt, visibleAt] of outOfRange)
    expect(await failure(gap(klass.id, hiddenAt, visibleAt))).toMatchObject({
      status: 400,
      fields: { gap: ["out_of_range"] },
    });
  expect(
    await failure(
      workspaceRequest(`/api/classes/${klass.id}/learning`, "POST", {
        action: "foreground_gap",
        hiddenAt: "yesterday",
        visibleAt: new Date(now).toISOString(),
      }),
    ),
  ).toMatchObject({ status: 400 });
  expect(
    await db
      .selectFrom("proc.foreground_gap")
      .select("id")
      .where("session_id", "=", klass.id)
      .execute(),
  ).toHaveLength(0);
});
