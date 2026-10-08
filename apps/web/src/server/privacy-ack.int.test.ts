import { createHash, randomUUID } from "node:crypto";
import { getAccountState, tombstoneAccount } from "@recalino/core/acc";
import { getSession } from "@recalino/core/org";
import type { DeletionJournalEntry } from "@recalino/core/priv";
import { acceptSourceNotice, createSource, getSource, readInputContract } from "@recalino/core/src";
import { beforeEach, expect, it, vi } from "vitest";
import { defineRoute, type Handler } from "./api";
import { authSessions, privacySessions } from "./auth/learner";
import { newLearner, requestAs } from "./cross-account/learners";
import { orgFixture, orgTestDatabase } from "./cross-account/org-support";
import { classSessionHandler } from "./org-routes";
import { accountDeletionHandler, privacyRequestHandler } from "./privacy-routes";
import { ROUTES, type RouteMeta } from "./routes";
import { sourceHandler } from "./source-routes";
import { fakeAuth, routeDeps } from "./test-support";

const effects = vi.hoisted(() => ({ journal: vi.fn(), jobs: vi.fn(), cleanup: vi.fn() }));
vi.mock("./db", () => ({ getDatabase: () => db }));
vi.mock("./jobs", () => ({ runJobsSoon: effects.jobs }));
vi.mock("./source-jobs", () => ({
  sourceAudioJobDefinition: () => null,
  sourceUploadJobDefinition: () => null,
}));
vi.mock("./privacy", () => ({
  privacyDependencies: () => ({
    hooks: [
      {
        module: "fixture",
        tombstoneSession: async () => {},
        tombstoneAccount: async () => {},
        tombstoneSource: async () => {},
        cleanupSession: effects.cleanup,
        cleanupAccount: effects.cleanup,
        cleanupSource: effects.cleanup,
      },
    ],
    deletionJournal: { record: effects.journal },
  }),
}));

const db = orgTestDatabase();
beforeEach(() => {
  effects.journal.mockReset();
  effects.jobs.mockClear();
  effects.cleanup.mockClear();
});
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(["session", "source", "account"] as const)(
  "%s deletion acknowledges one durable journal receipt after a failed write and retry",
  async (kind) => {
    const fixture = await orgFixture(db);
    let verifiedIdentity: string | null = fixture.owner;
    const auth = fakeAuth().gateway;
    auth.currentUser = async () => (verifiedIdentity ? { id: verifiedIdentity } : null);
    const privacyAuthentication = privacySessions(auth, () => db);
    const key = randomUUID();
    let subjectId = fixture.session.id;
    let metadata: RouteMeta = ROUTES.classSession;
    let handler: Handler = classSessionHandler(subjectId);
    let body: unknown;
    let path = `/api/classes/${subjectId}`;
    if (kind === "source") {
      const contract = await readInputContract(db);
      await acceptSourceNotice(db, fixture.actor, contract.noticeVersion, true);
      const bytes = Buffer.from("Synthetic device audio");
      const source = await createSource(db, fixture.actor, {
        sessionId: fixture.session.id,
        kind: "audio",
        mimeType: "audio/webm",
        displayName: "Synthetic.webm",
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        durationMs: 1000,
        parts: [],
        operationKey: randomUUID(),
      });
      subjectId = source.assetId;
      metadata = ROUTES.source;
      handler = sourceHandler(subjectId);
      body = { mode: "all" };
      path = `/api/sources/${subjectId}`;
    } else if (kind === "account") {
      subjectId = fixture.owner;
      metadata = { ...ROUTES.privacyAccount, idempotency: "handler" };
      handler = accountDeletionHandler();
      body = { confirm: "DELETE" };
      path = "/api/privacy/account";
    }
    const route = defineRoute(metadata, handler, {
      ...routeDeps(db),
      ...(kind === "account" ? { sessions: privacyAuthentication } : {}),
    });
    function remove() {
      const request = requestAs(fixture.owner, path, "DELETE", body);
      request.headers.set("idempotency-key", key);
      return route(request);
    }

    const entered = deferred();
    const finishWrite = deferred();
    const durable = new Map<string, DeletionJournalEntry>();
    async function append(entry: DeletionJournalEntry) {
      const previous = durable.get(entry.requestId);
      if (previous) expect(previous).toEqual(entry);
      durable.set(entry.requestId, entry);
    }
    effects.journal
      .mockRejectedValueOnce(new Error("Synthetic durable journal interruption"))
      .mockImplementationOnce(async (entry: DeletionJournalEntry) => {
        entered.resolve();
        await finishWrite.promise;
        await append(entry);
      })
      .mockImplementation(append);

    const failed = await remove();
    expect(failed.status).toBe(500);
    const failedBody = await failed.json();
    expect(JSON.stringify(failedBody)).not.toContain("Synthetic durable journal interruption");
    expect(effects.jobs).not.toHaveBeenCalled();
    expect(effects.cleanup).not.toHaveBeenCalled();
    expect(durable.size).toBe(0);
    const receipts = await db
      .selectFrom("priv.deletion_request")
      .selectAll()
      .where("user_id", "=", fixture.owner)
      .execute();
    expect(receipts).toHaveLength(1);
    const receipt = receipts[0];
    if (!receipt) throw new Error("Missing synthetic deletion receipt");
    expect(receipt.kind).toBe(kind);
    expect(receipt.subject_id).toBe(subjectId);
    expect(receipt.state).toBe("pending");
    if (kind === "account") {
      expect(failedBody.error.details).toEqual({
        deletion: {
          requestId: receipt.id,
          kind: "account",
          state: "acknowledgement_pending",
        },
      });
    }
    if (kind === "session") {
      await expect(getSession(db, fixture.actor, subjectId)).rejects.toMatchObject({
        code: "not_found",
      });
    } else if (kind === "source") {
      await expect(getSource(db, fixture.actor, subjectId)).rejects.toMatchObject({
        code: "not_found",
      });
    } else {
      expect(await getAccountState(db, fixture.owner)).toBeNull();
      expect(
        await authSessions(auth).getSession(requestAs(fixture.owner, path, "DELETE")),
      ).toBeNull();
      expect(
        await privacyAuthentication.getSession(requestAs(fixture.owner, path, "DELETE")),
      ).toEqual({
        userId: fixture.owner,
      });
    }

    let acknowledged = false;
    const retried = remove().then((response) => {
      acknowledged = true;
      return response;
    });
    await entered.promise;
    expect(acknowledged).toBe(false);
    expect(durable.size).toBe(0);
    expect(effects.jobs).not.toHaveBeenCalled();
    finishWrite.resolve();
    const accepted = await retried;
    expect(accepted.status).toBe(202);
    const acceptedBody = await accepted.json();
    expect(kind === "source" ? acceptedBody.privacyRequestId : acceptedBody.id).toBe(receipt.id);
    if (kind === "source") {
      const sourceReceipt = await db
        .selectFrom("src.asset")
        .select("deletion_request_id")
        .where("id", "=", subjectId)
        .executeTakeFirstOrThrow();
      expect(acceptedBody.deletionRequestId).toBe(sourceReceipt.deletion_request_id);
      expect(acceptedBody.deletionRequestId).not.toBe(receipt.id);
      expect(durable.get(receipt.id)?.relatedSessions).toEqual([fixture.session.id]);
    }
    expect(durable.size).toBe(1);
    expect(durable.get(receipt.id)).toMatchObject({
      requestId: receipt.id,
      userId: fixture.owner,
      subjectId,
      kind,
    });
    expect(effects.journal.mock.calls[0]?.[0]).toEqual(effects.journal.mock.calls[1]?.[0]);
    expect(effects.jobs).toHaveBeenCalledOnce();
    expect((await remove()).status).toBe(202);
    expect(durable.size).toBe(1);
    expect(
      await db
        .selectFrom("priv.deletion_request")
        .select("id")
        .where("user_id", "=", fixture.owner)
        .execute(),
    ).toEqual([{ id: receipt.id }]);
    expect(effects.cleanup).not.toHaveBeenCalled();

    const receiptRoute = defineRoute(ROUTES.privacyRequest, privacyRequestHandler(receipt.id), {
      ...routeDeps(db),
      sessions: privacyAuthentication,
    });
    const receiptPath = `/api/privacy/${receipt.id}`;
    expect((await receiptRoute(requestAs(fixture.owner, receiptPath, "GET"))).status).toBe(200);
    verifiedIdentity = await newLearner(db);
    const foreign = await receiptRoute(requestAs(fixture.owner, receiptPath, "GET"));
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.details).toBeUndefined();
    verifiedIdentity = null;
    expect((await receiptRoute(requestAs(fixture.owner, receiptPath, "GET"))).status).toBe(401);
  },
);

it("a tombstoned account without its own pending deletion receipt cannot authenticate for privacy", async () => {
  const fixture = await orgFixture(db);
  await db.transaction().execute((tx) => tombstoneAccount(tx, fixture.actor));
  const auth = fakeAuth().gateway;
  auth.currentUser = async () => ({ id: fixture.owner });
  const route = defineRoute(
    { ...ROUTES.privacyAccount, idempotency: "handler" },
    accountDeletionHandler(),
    { ...routeDeps(db), sessions: privacySessions(auth, () => db) },
  );
  const request = requestAs(fixture.owner, "/api/privacy/account", "DELETE", { confirm: "DELETE" });
  request.headers.set("idempotency-key", randomUUID());
  expect((await route(request)).status).toBe(401);
  expect(effects.journal).not.toHaveBeenCalled();
  expect(effects.jobs).not.toHaveBeenCalled();
});
