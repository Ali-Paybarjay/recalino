import type { CompiledQuery } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockProvider, NOW, runSource, SESSION_ID, USER_ID } from "../../test/processing-run";
import { statementLogDatabase } from "../../test/statement-log";
import type { RunSource } from "./contracts";
import { createProcessingRun } from "./runs";

// QUA-01 characterization: createProcessingRun's order of locks, checks, reservation, adoption,
// enqueue and writes in its single transaction, with the database and collaborators mocked.
const m = vi.hoisted(() => ({
  log: [] as string[],
  account: undefined as unknown,
  preferences: [] as { key: string; origin: string; value: boolean }[],
  sources: [] as unknown[],
  live: undefined as string[] | undefined,
}));
vi.mock("node:crypto", async (original) => ({
  ...(await original<object>()),
  randomUUID: () => "77777777-7777-4777-8777-777777777777",
}));
vi.mock("../acc", async (original) => ({
  ...(await original<object>()),
  lockAccount: vi.fn(async (_tx: unknown, userId: string) => m.log.push(`lockAccount ${userId}`)),
  getAccountState: vi.fn(async () => {
    m.log.push("getAccountState");
    return m.account;
  }),
  listTeachingPreferences: vi.fn(async () => {
    m.log.push("listTeachingPreferences");
    return m.preferences;
  }),
}));
vi.mock("../org", async (original) => ({
  ...(await original<object>()),
  assertSessionOwner: vi.fn(async (_tx: unknown, _ctx: unknown, id: string) => {
    m.log.push(`assertSessionOwner ${id}`);
    return { id };
  }),
  filterLiveSessionIds: vi.fn(async (_tx: unknown, _ctx: unknown, ids: string[]) => {
    m.log.push(`filterLiveSessionIds ${JSON.stringify(ids)}`);
    return m.live ?? ids;
  }),
}));
vi.mock("../lkm", async (original) => ({
  ...(await original<object>()),
  getLatestVersion: vi.fn(async () => {
    m.log.push("getLatestVersion");
    return { id: "version" };
  }),
}));
vi.mock("../quota", async (original) => ({
  ...(await original<object>()),
  activeEntitlementId: vi.fn(async () => {
    m.log.push("activeEntitlementId");
    return "entitlement";
  }),
  reserveAllowance: vi.fn(
    async (_tx: unknown, _ctx: unknown, key: string, requested: unknown, now: Date) => {
      m.log.push(`reserveAllowance ${key} ${JSON.stringify(requested)} ${now.toISOString()}`);
      return { id: "reservation" };
    },
  ),
}));
vi.mock("../src", async (original) => ({
  ...(await original<object>()),
  selectSourceSnapshot: vi.fn(async () => {
    m.log.push("selectSourceSnapshot");
    return { sourcesVersion: 3, fingerprint: "f".repeat(64), sources: m.sources };
  }),
  adoptStagedAudio: vi.fn(async (_tx: unknown, _ctx: unknown, ids: string[]) =>
    m.log.push(`adoptStagedAudio ${JSON.stringify(ids)}`),
  ),
}));
vi.mock("./charged-material", async (original) => ({
  ...(await original<object>()),
  chargeableRunAmounts: vi.fn(
    async (_tx: unknown, _ctx: unknown, input: { sources: unknown[] }) => {
      m.log.push(
        `chargeableRunAmounts ${JSON.stringify({ ...input, sources: input.sources.length })}`,
      );
      return { units: 1 };
    },
  ),
}));
vi.mock("./knowledge-reuse", () => ({
  reuseCompletedKnowledge: vi.fn(async (_tx: unknown, _ctx: unknown, input: { runId: string }) =>
    m.log.push(`reuseCompletedKnowledge ${input.runId}`),
  ),
}));
vi.mock("../plt", async (original) => ({
  ...(await original<object>()),
  readPltSettings: () => ({ jobs: { synthetic: true } }),
  enqueueJob: vi.fn(async (_tx: unknown, definition: { kind: string }, input: unknown) => {
    m.log.push(`enqueueJob ${definition.kind} ${JSON.stringify(input)}`);
    return "job";
  }),
}));

const ID = "77777777-7777-4777-8777-777777777777";
const PRIOR_RUN = "88888888-8888-4888-8888-888888888888";
const ctx = { userId: USER_ID, requestId: "create-run-test" };
const provider = mockProvider();
const job = { kind: "proc.process", version: 1, payload: {} } as never;
const point = (sourceSessionId: string) => ({
  target: "look forward to",
  reason: "recall_difficulty" as const,
  scope: "same_course" as const,
  againCount: 2,
  lastEvidenceDate: "2026-10-18",
  sourceSessionId,
});
function account(overrides: Record<string, unknown> = {}) {
  return {
    setupComplete: true,
    pending: { terms: false, recordingConsent: false },
    profile: {
      explanationLanguage: "first",
      firstLanguage: "fa",
      version: 4,
      level: "B1",
      goal: "general",
    },
    ...overrides,
  };
}
function runRow(input: Record<string, unknown>) {
  return {
    id: input.id ?? ID,
    user_id: USER_ID,
    session_id: SESSION_ID,
    state: input.state ?? "queued",
    reservation_id: "reservation",
    sources_version: 3,
    input_snapshot: {},
    last_error: null,
    output_version_id: null,
    created_at: NOW,
    updated_at: NOW,
    request_hash: input.request_hash,
  };
}
function label(query: CompiledQuery) {
  const text = query.sql;
  if (
    text.startsWith(
      'select * from "proc"."processing_run" where "user_id" = $1 and "operation_key"',
    )
  )
    return "read operation run";
  if (text.startsWith('select "id" from "proc"."processing_run" where "user_id"'))
    return "read newest class run";
  if (
    text.startsWith(
      'select "run_id", "request_version", "batch_id" from "proc"."automatic_session"',
    )
  )
    return text.endsWith("for update") ? "lock automatic intent" : text;
  if (text.startsWith('select "request_version", "batch_id" from "proc"."automatic_session"'))
    return "read automatic intent";
  if (text.startsWith('select "id" from "proc"."processing_run" where "session_id"'))
    return "read active run";
  if (text.startsWith('select "proc"."provider_attempt"."id"')) return "read unresolved attempt";
  if (text.startsWith('select "user_id", "session_id", settings ->'))
    return "read inherited points";
  if (text.startsWith('insert into "proc"."processing_run"')) return "insert run";
  if (text.startsWith('update "proc"."automatic_session"')) return "update automatic intent";
  return text;
}
interface Rows {
  previous?: Record<string, unknown>;
  newest?: string;
  operatorIntent?: Record<string, unknown>;
  intent?: Record<string, unknown>;
  active?: boolean;
  unresolved?: boolean;
  inherited?: Record<string, unknown>;
}
function setup(rows: Rows = {}) {
  const fixture = statementLogDatabase((query) => {
    const name = label(query);
    if (name === "read operation run") return rows.previous ? [rows.previous] : [];
    if (name === "read newest class run") return rows.newest ? [{ id: rows.newest }] : [];
    if (name === "lock automatic intent") return rows.operatorIntent ? [rows.operatorIntent] : [];
    if (name === "read automatic intent") return rows.intent ? [rows.intent] : [];
    if (name === "read active run") return rows.active ? [{ id: "active" }] : [];
    if (name === "read unresolved attempt") return rows.unresolved ? [{ id: "attempt" }] : [];
    if (name === "read inherited points") return rows.inherited ? [rows.inherited] : [];
    if (name === "insert run") {
      const state = query.parameters[11];
      return [runRow({ state })];
    }
    return [];
  });
  m.log = fixture.log;
  const labelled = () => {
    let index = 0;
    return fixture.log.map((entry) =>
      fixture.statements[index]?.sql === entry
        ? label(fixture.statements[index++] as CompiledQuery)
        : entry,
    );
  };
  const statement = (name: string) => fixture.statements.find((query) => label(query) === name);
  return { db: fixture.db, labelled, statement };
}
const request = (extra: Record<string, unknown> = {}) => ({
  sessionId: SESSION_ID,
  operationKey: "operation-key-1",
  ...extra,
});
const create = (
  db: ReturnType<typeof setup>["db"],
  extra: Record<string, unknown> = {},
  options: Partial<Parameters<typeof createProcessingRun>[3]> = {},
) => createProcessingRun(db, ctx, request(extra), { provider, job, now: NOW, ...options });
const checks = [
  "begin",
  `lockAccount ${USER_ID}`,
  `assertSessionOwner ${SESSION_ID}`,
  "read operation run",
];
const charge = (sources = 1) => [
  "activeEntitlementId",
  "getLatestVersion",
  `chargeableRunAmounts ${JSON.stringify({
    sessionId: SESSION_ID,
    entitlementId: "entitlement",
    sources,
    charactersPerPage: 1800,
    regeneration: true,
  })}`,
  `reserveAllowance processing:${ID} {"units":1} ${NOW.toISOString()}`,
];
const enqueue = `enqueueJob proc.process ${JSON.stringify({
  payload: { runId: ID, userId: USER_ID },
  singletonKey: ID,
  now: NOW,
  defaults: { synthetic: true },
})}`;

beforeEach(() => {
  m.account = account();
  m.preferences = [];
  m.sources = [runSource()];
  m.live = undefined;
});

describe("createProcessingRun (characterization)", () => {
  it("reserves, snapshots, enqueues and inserts a class run in one transaction", async () => {
    const { db, labelled, statement } = setup();
    const run = await create(db);
    expect(run).toMatchObject({ id: ID, sessionId: SESSION_ID, state: "queued" });
    expect(labelled()).toEqual([
      ...checks,
      "getAccountState",
      "read active run",
      "read unresolved attempt",
      "selectSourceSnapshot",
      ...charge(),
      "adoptStagedAudio []",
      "listTeachingPreferences",
      "filterLiveSessionIds []",
      enqueue,
      "insert run",
      "commit",
    ]);
    const values = statement("insert run")?.parameters ?? [];
    expect(values.slice(0, 6)).toEqual([
      ID,
      USER_ID,
      SESSION_ID,
      "operation-key-1",
      expect.stringMatching(/^[a-f0-9]{64}$/),
      3,
    ]);
    expect(values.slice(9)).toEqual(['{"units":1}', "reservation", "queued", "job", NOW, NOW]);
    expect(JSON.parse(values[8] as string)).toEqual({
      provider: provider.settings,
      explanationLanguage: "fa",
      profileVersion: 4,
      learnerContext: { version: 1, declaredLevel: "B1", goal: "general" },
      teachingPreferences: { shorterExamples: false },
    });
  });

  it("replays the same request and refuses a different one with the same key", async () => {
    const first = setup();
    await create(first.db);
    const hash = first.statement("insert run")?.parameters[4];
    const replay = setup({ previous: runRow({ request_hash: hash, state: "processing" }) });
    expect(await create(replay.db)).toMatchObject({ id: ID, state: "processing" });
    expect(replay.labelled()).toEqual([...checks, "commit"]);
    const other = setup({ previous: runRow({ request_hash: "other" }) });
    await expect(create(other.db)).rejects.toMatchObject({ code: "idempotency_mismatch" });
    expect(other.labelled().at(-1)).toBe("rollback");
  });

  it.each([
    ["an account without accepted terms", { pending: { terms: true } }, "acceptance_required"],
    ["an unfinished setup", { setupComplete: false }, "acceptance_required"],
  ])("refuses %s before any run read", async (_name, overrides, code) => {
    m.account = account(overrides);
    const { db, labelled } = setup();
    await expect(create(db)).rejects.toMatchObject({
      details: { fields: { profile: [code] } },
    });
    expect(labelled()).toEqual([...checks, "getAccountState", "rollback"]);
  });

  it("refuses while another run or an unresolved paid attempt exists", async () => {
    const active = setup({ active: true });
    await expect(create(active.db)).rejects.toMatchObject({ code: "conflict" });
    const unresolved = setup({ unresolved: true });
    await expect(create(unresolved.db)).rejects.toMatchObject({
      details: { fields: { retry: ["provider_outcome_unresolved"] } },
    });
    expect(unresolved.labelled().slice(-3)).toEqual([
      "read active run",
      "read unresolved attempt",
      "rollback",
    ]);
  });

  it.each([[{ expectedFingerprint: "e".repeat(64) }], [{ expectedSourcesVersion: 2 }]])(
    "refuses a selection that changed after the estimate (%o)",
    async (extra) => {
      const { db, labelled } = setup();
      await expect(create(db, extra)).rejects.toMatchObject({
        details: { fields: { sources: ["changed_after_estimate"] } },
      });
      expect(labelled().slice(-2)).toEqual(["selectSourceSnapshot", "rollback"]);
    },
  );

  it("checks an automatic request against its intent before the account", async () => {
    const current = setup({ intent: { request_version: 5, batch_id: null } });
    await create(current.db, { automaticRequestVersion: 5 });
    expect(current.labelled().slice(4, 6)).toEqual(["read automatic intent", "getAccountState"]);
    for (const intent of [
      undefined,
      { request_version: 4, batch_id: null },
      { request_version: 5, batch_id: "batch" },
    ]) {
      const changed = setup({ intent });
      await expect(create(changed.db, { automaticRequestVersion: 5 })).rejects.toMatchObject({
        details: { fields: { sources: ["changed_after_estimate"] } },
      });
    }
  });

  it("waits for audio without a server copy and adopts staged copies", async () => {
    const waiting = runSource({ kind: "audio", objectId: null, contentVersionId: null });
    const staged = runSource({
      kind: "audio",
      objectId: "99999999-9999-4999-8999-999999999999",
      contentVersionId: null,
    });
    m.sources = [waiting, staged] as RunSource[];
    const { db, labelled, statement } = setup();
    expect(await create(db)).toMatchObject({ state: "awaiting_upload" });
    expect(labelled()).toContain(`adoptStagedAudio ${JSON.stringify([staged.sourceId])}`);
    expect(labelled().some((entry) => entry.startsWith("enqueueJob"))).toBe(false);
    expect(statement("insert run")?.parameters.slice(11, 13)).toEqual(["awaiting_upload", null]);
  });

  it("freezes memory points from live classes and the explicit simpler choice", async () => {
    const deleted = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    m.live = [SESSION_ID];
    m.preferences = [
      { key: "simpler_explanations", origin: "explicit", value: true },
      { key: "shorter_examples", origin: "inferred", value: true },
    ];
    const practiceCandidates = vi.fn(async (_tx: unknown, input: unknown) => {
      m.log.push(`practiceCandidates ${JSON.stringify(input)}`);
      return [point(SESSION_ID), point(deleted)];
    });
    const { db, labelled, statement } = setup();
    await create(db, {}, { teachingMemory: true, practiceCandidates });
    expect(labelled().slice(-6, -3)).toEqual([
      "listTeachingPreferences",
      `practiceCandidates ${JSON.stringify({ sessionId: SESSION_ID, now: NOW })}`,
      `filterLiveSessionIds ${JSON.stringify([SESSION_ID, deleted])}`,
    ]);
    expect(JSON.parse(statement("insert run")?.parameters[8] as string)).toMatchObject({
      learnerContext: {
        version: 2,
        simplerExplanations: true,
        practiceCandidates: [point(SESSION_ID)],
      },
      teachingPreferences: { shorterExamples: false },
    });
    const off = setup();
    await create(off.db, {}, { practiceCandidates });
    expect(practiceCandidates).toHaveBeenCalledTimes(1);
  });

  it("recovers an operator retry: pinned newest run, its points, knowledge reuse, intent update", async () => {
    const { db, labelled, statement } = setup({
      newest: PRIOR_RUN,
      operatorIntent: { run_id: PRIOR_RUN, request_version: 7, batch_id: null },
      inherited: {
        user_id: USER_ID,
        session_id: SESSION_ID,
        learner_context: { version: 2, practiceCandidates: [point(SESSION_ID)] },
      },
    });
    await create(
      db,
      {},
      {
        expectedLatestClassRunId: PRIOR_RUN,
        reuseCompletedKnowledge: true,
        teachingMemory: true,
        inheritPracticeCandidatesFrom: PRIOR_RUN,
      },
    );
    expect(labelled()).toEqual([
      ...checks,
      "read newest class run",
      "lock automatic intent",
      "getAccountState",
      "read active run",
      "read unresolved attempt",
      "selectSourceSnapshot",
      ...charge(),
      "adoptStagedAudio []",
      "listTeachingPreferences",
      "read inherited points",
      `filterLiveSessionIds ${JSON.stringify([SESSION_ID])}`,
      enqueue,
      "insert run",
      `reuseCompletedKnowledge ${ID}`,
      "update automatic intent",
      "commit",
    ]);
    expect(statement("update automatic intent")?.parameters).toEqual([
      ID,
      "processing",
      null,
      NOW,
      USER_ID,
      SESSION_ID,
      7,
    ]);
  });

  it.each([
    ["a newer class run", { newest: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
    [
      "an open upload batch",
      { newest: PRIOR_RUN, operatorIntent: { run_id: null, request_version: 1, batch_id: "b" } },
    ],
    [
      "an intent bound to another run",
      {
        newest: PRIOR_RUN,
        operatorIntent: { run_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", request_version: 1 },
      },
    ],
  ])("refuses an operator retry after %s", async (_name, rows) => {
    const { db } = setup(rows);
    await expect(create(db, {}, { expectedLatestClassRunId: PRIOR_RUN })).rejects.toMatchObject({
      code: "conflict",
    });
  });
});
