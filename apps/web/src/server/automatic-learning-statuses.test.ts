import type { Database } from "@recalino/core/db";
import { errors } from "@recalino/core/plt";
import type {
  AutomaticLearningSession,
  ProcessingReview,
  ProcessingRun,
  RunFinishingStage,
} from "@recalino/core/proc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAutomaticLearning, readAutomaticLearningStatuses } from "./automatic-learning";

// PERF-04: Today's statuses read in bulk equal each class's own status read; with the core reads
// mocked over one synthetic model, this checks the composition, not the SQL.
interface ClassModel {
  live: boolean;
  intent?: AutomaticLearningSession;
  published?: boolean;
  runs?: ProcessingRun[];
  review?: ProcessingReview | null;
}
const m = vi.hoisted(() => ({
  classes: new Map<string, ClassModel>(),
  stages: new Map<string, RunFinishingStage | null>(),
  calls: [] as string[],
  bulkFailure: false,
}));
const call = (name: string) => m.calls.push(name);
const liveClass = (id: string) => {
  const model = m.classes.get(id);
  if (!model?.live) throw errors.notFound();
  return model;
};
const allRuns = () => [...m.classes.values()].flatMap((model) => model.runs ?? []);
vi.mock("@recalino/core/org", async (original) => ({
  ...(await original<object>()),
  getSession: vi.fn(async (_db: unknown, _ctx: unknown, id: string) => {
    call("getSession");
    return { id: liveClass(id) && id };
  }),
  getSessionsByIds: vi.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => {
    call("getSessionsByIds");
    if (m.bulkFailure) throw new Error("connection reset");
    return ids.filter((id) => m.classes.get(id)?.live).map((id) => ({ id }));
  }),
}));
vi.mock("@recalino/core/note", async (original) => ({
  ...(await original<object>()),
  hasPublishedNotebook: vi.fn(async (_db: unknown, _ctx: unknown, id: string) => {
    call("hasPublishedNotebook");
    return Boolean(liveClass(id).published);
  }),
  publishedNotebookSessionIds: vi.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => {
    call("publishedNotebookSessionIds");
    return new Set(ids.filter((id) => m.classes.get(id)?.published));
  }),
}));
vi.mock("@recalino/core/proc", async (original) => ({
  ...(await original<object>()),
  getAutomaticLearningSession: vi.fn(async (_db: unknown, _ctx: unknown, id: string) => {
    call("getAutomaticLearningSession");
    return liveClass(id).intent ?? null;
  }),
  listAutomaticLearningSessions: vi.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => {
    call("listAutomaticLearningSessions");
    return new Map(
      ids.flatMap((id) => {
        const model = m.classes.get(id);
        return model?.live && model.intent ? [[id, model.intent] as const] : [];
      }),
    );
  }),
  getRun: vi.fn(async (_db: unknown, _ctx: unknown, runId: string) => {
    call("getRun");
    const found = allRuns().find((item) => item.id === runId);
    if (!found) throw errors.notFound();
    return found;
  }),
  listClassRunsBySession: vi.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => {
    call("listClassRunsBySession");
    return new Map(ids.map((id) => [id, m.classes.get(id)?.runs ?? []]));
  }),
  runFinishingStage: vi.fn(async (_db: unknown, _ctx: unknown, runId: string) => {
    call("runFinishingStage");
    return m.stages.get(runId) ?? null;
  }),
  runFinishingStages: vi.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => {
    call("runFinishingStages");
    return new Map(ids.map((id) => [id, m.stages.get(id) ?? null]));
  }),
  getProcessingRunSnapshot: vi.fn(async () => {
    call("getProcessingRunSnapshot");
    return { sourcesVersion: 1, fingerprint: "a".repeat(64), sources: [] };
  }),
  readClassProcessingReview: vi.fn(async (_db: unknown, _ctx: unknown, id: string) => {
    call("readClassProcessingReview");
    return liveClass(id).review ?? null;
  }),
  readClassProcessingReviews: vi.fn(
    async (_db: unknown, _ctx: unknown, input: { runs: Map<string, unknown> }) => {
      call("readClassProcessingReviews");
      return new Map([...input.runs.keys()].map((id) => [id, m.classes.get(id)?.review ?? null]));
    },
  ),
}));

const db = {} as Database;
const ctx = { userId: "11111111-1111-4111-8111-111111111111", requestId: "statuses" };
const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const run = (n: number, state: ProcessingRun["state"]): ProcessingRun => ({
  id: id(100 + n),
  sessionId: id(n),
  state,
  reservationId: id(200 + n),
  sourcesVersion: 1,
  lastError: state === "failed" ? "provider_http_500" : null,
  outputVersionId: state === "ready" ? id(300 + n) : null,
  createdAt: "2026-10-19T10:00:00.000Z",
  updatedAt: "2026-10-19T10:00:00.000Z",
});
const intent = (
  n: number,
  state: AutomaticLearningSession["state"],
  runId: string | null,
  lastError: string | null = null,
): AutomaticLearningSession => ({
  sessionId: id(n),
  userId: ctx.userId,
  requestVersion: 2,
  requestedVersion: 2,
  requestedAt: "2026-10-19T10:00:00.000Z",
  batchId: null,
  lastBatchId: null,
  batchStartedAt: null,
  batchFiles: null,
  state,
  lastError,
  runId,
  updatedAt: "2026-10-19T10:00:00.000Z",
  enabledAt: "2026-10-19T10:00:00.000Z",
});
const noProvider = () => undefined;

beforeEach(() => {
  m.calls = [];
  m.bulkFailure = false;
  m.stages = new Map([[run(4, "processing").id, "checking_voices"]]);
  const failed = run(5, "failed");
  m.classes = new Map<string, ClassModel>([
    [id(1), { live: true }],
    [
      id(2),
      {
        live: true,
        published: true,
        intent: intent(2, "ready", run(2, "ready").id),
        runs: [run(2, "ready")],
      },
    ],
    [id(3), { live: true, intent: intent(3, "waiting_sources", null) }],
    [
      id(4),
      {
        live: true,
        intent: intent(4, "processing", run(4, "processing").id),
        runs: [run(4, "processing")],
      },
    ],
    [
      id(5),
      {
        live: true,
        published: true,
        intent: intent(5, "blocked", failed.id, "provider_http_500"),
        runs: [failed],
        review: {
          state: "not_requested",
          runId: failed.id,
          requestedRunId: null,
          requestedAt: null,
          updatedAt: failed.updatedAt,
          errorCode: "provider_http_500",
          canRequest: true,
          partialResult: false,
        },
      },
    ],
    [
      id(6),
      {
        live: true,
        intent: intent(6, "waiting_upload", run(6, "awaiting_upload").id),
        runs: [run(6, "awaiting_upload")],
      },
    ],
    // An intent naming a run that is not among the class's newest runs is read on its own.
    [
      id(7),
      { live: true, intent: intent(7, "ready", run(70, "ready").id), runs: [run(7, "failed")] },
    ],
    [id(8), { live: false }],
    [id(9), { live: true, intent: intent(9, "processing", id(999)), runs: [] }],
  ]);
  m.classes.set(id(70), { live: false, runs: [run(70, "ready")] });
});

describe("readAutomaticLearningStatuses (PERF-04)", () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);
  const separately = () =>
    Promise.all(
      ids.map((item) => readAutomaticLearning(db, ctx, item, noProvider).catch(() => null)),
    );

  it("returns each class's own status, or null where that read fails", async () => {
    const expected = await separately();
    expect(expected[7]).toBeNull();
    expect(expected[8]).toBeNull();
    expect(expected[3]?.stage).toBe("checking_voices");
    expect(expected[5]?.snapshot).not.toBeNull();
    m.calls = [];
    expect(await readAutomaticLearningStatuses(db, ctx, ids, noProvider)).toEqual(expected);
  });

  it("makes each bulk read once, whatever the number of classes", async () => {
    await readAutomaticLearningStatuses(db, ctx, ids, noProvider);
    const counts = (names: string[]) =>
      names.map((name) => m.calls.filter((entry) => entry === name).length);
    expect(
      counts([
        "getSessionsByIds",
        "listAutomaticLearningSessions",
        "publishedNotebookSessionIds",
        "listClassRunsBySession",
        "readClassProcessingReviews",
        "runFinishingStages",
      ]),
    ).toEqual([1, 1, 1, 1, 1, 1]);
    // Per-class reads remain only where a class's run is not among its newest runs, and for the
    // snapshot of a run waiting for its upload.
    expect(
      counts([
        "getSession",
        "getAutomaticLearningSession",
        "hasPublishedNotebook",
        "readClassProcessingReview",
      ]),
    ).toEqual([0, 0, 0, 0]);
    expect(counts(["getRun", "getProcessingRunSnapshot", "runFinishingStage"])).toEqual([2, 1, 0]);
  });

  it("reads each class on its own when a bulk read fails", async () => {
    const expected = await separately();
    m.bulkFailure = true;
    m.calls = [];
    expect(await readAutomaticLearningStatuses(db, ctx, ids, noProvider)).toEqual(expected);
    expect(m.calls.filter((entry) => entry === "getSession")).toHaveLength(ids.length);
  });
});
