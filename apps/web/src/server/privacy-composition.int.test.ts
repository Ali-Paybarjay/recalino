import { createHash, randomUUID } from "node:crypto";
import { ankiExportJob, getAnkiExport, requestAnkiExport } from "@recalino/core/anki";
import { getCard, setCardMedia } from "@recalino/core/card";
import { createDatabase } from "@recalino/core/db";
import { getHtmlExport, htmlExportJob, requestHtmlExport } from "@recalino/core/html";
import { getVersion } from "@recalino/core/lkm";
import { createImageMedia, getMediaAsset, mediaReadLink } from "@recalino/core/media";
import { getNotebookRevision, publishNotebook } from "@recalino/core/note";
import { createCourse, createUnit, getSession, updateSession } from "@recalino/core/org";
import { recordItemFeedback } from "@recalino/core/pers";
import {
  DEFAULT_PLT_SETTINGS,
  type JobContext,
  MemoryObjectStore,
  readOwnedObject,
} from "@recalino/core/plt";
import {
  coordinateSourceDeletion,
  getPrivacyDeletionRequest,
  privacyCleanupJob,
  requestAccountDeletion,
  requestSessionDeletion,
} from "@recalino/core/priv";
import { scheduleAuxiliaryRun } from "@recalino/core/proc";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import {
  acceptSourceNotice,
  confirmUploadPart,
  createSource,
  DefaultSourceVerifier,
  deleteSource,
  getSource,
  readInputContract,
  uploadPartLink,
  verifyUpload,
} from "@recalino/core/src";
import { sql } from "kysely";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { testDatabaseUrl } from "../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../packages/core/test/study-fixture";
import { privacyDependencies } from "./privacy";

const store = new MemoryObjectStore();
const deleteIdentity = vi.fn(async () => ({ error: null }));
vi.mock("./storage", () => ({ getObjectStore: () => store }));
vi.mock("./auth/supabase", () => ({ createAuthAdmin: () => ({ deleteUser: deleteIdentity }) }));
const db = createDatabase(testDatabaseUrl(), { maxConnections: 3 });
afterAll(() => db.destroy());
const exportSettings = {
  version: "composition-test",
  maxBytes: 1000000,
  maxItems: 1000,
  retentionSeconds: 3600,
};
const unusedJob = {
  kind: "fixture.private",
  version: 1,
  payload: z.strictObject({ runId: z.uuid(), userId: z.uuid(), subjectId: z.uuid() }),
  async run() {},
};

async function fixture() {
  const study = await studyFixture(db, { count: 1, autoAdd: true });
  const course = await createCourse(
    db,
    study.ctx,
    { name: "Private synthetic course name" },
    { key: randomUUID() },
  );
  const unit = await createUnit(
    db,
    study.ctx,
    { courseId: course.id, name: "Private synthetic unit name" },
    { key: randomUUID() },
  );
  const session = await updateSession(db, study.ctx, study.session.id, {
    courseId: course.id,
    unitId: unit.id,
    title: "Private synthetic class title",
    classDate: "2026-09-30",
  });
  const entitlementId = await grantEntitlement(db, {
    userId: study.ctx.userId,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 86400000),
    amounts: amounts({ storage: 100000000 }),
    actorId: "synthetic-fixture",
    reason: "Private composition regression only",
    operationKey: randomUUID(),
  });
  await acceptSourceNotice(db, study.ctx, (await readInputContract(db)).noticeVersion, true);
  async function upload(kind: "image" | "text", bytes: Uint8Array, mimeType: string) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const source = await createSource(db, study.ctx, {
      sessionId: study.session.id,
      kind,
      mimeType,
      sizeBytes: bytes.length,
      sha256: hash,
      displayName: `private.${kind}`,
      parts: [{ index: 0, sizeBytes: bytes.length, sha256: hash }],
      operationKey: randomUUID(),
    });
    if (!source.uploadId) throw new Error("Upload is missing");
    const link = await uploadPartLink(
      db,
      store,
      study.ctx,
      source.uploadId,
      0,
      DEFAULT_PLT_SETTINGS.storage,
    );
    expect(store.upload(link.url, bytes, mimeType)).toBe(200);
    await confirmUploadPart(db, store, study.ctx, source.uploadId, 0);
    await verifyUpload(db, store, study.ctx, source.uploadId, {
      verifier: new DefaultSourceVerifier(),
    });
    return source.assetId;
  }
  const imageId = await upload(
    "image",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    "image/png",
  );
  const textId = await upload(
    "text",
    new TextEncoder().encode("Private synthetic source text."),
    "text/plain",
  );
  const media = await createImageMedia(db, store, study.ctx, {
    sessionId: study.session.id,
    sourceId: imageId,
    operationKey: randomUUID(),
    exportAllowed: false,
  });
  const card = study.cards[0];
  if (!card || !media.objectId) throw new Error("Study fixture is incomplete");
  await setCardMedia(
    db,
    study.ctx,
    card.id,
    { expectedVersion: card.contentVersion, side: "front", mediaId: media.id },
    { key: randomUUID() },
  );
  // D48: a learner correction about this class's goal is deleted with the class or account.
  await recordItemFeedback(
    db,
    study.ctx,
    { learningItemId: card.learningItemId, kind: "explain_simpler", active: true },
    { key: randomUUID() },
  );
  const noteKey = randomUUID();
  const noteInput = {
    expectedRevisionId: study.notebook.current.id,
    edits: { title: "Private synthetic learner edit" },
  };
  const notebook = await publishNotebook(db, study.ctx, study.session.id, noteInput, {
    key: noteKey,
  });
  const runId = await db.transaction().execute((tx) =>
    scheduleAuxiliaryRun(tx, study.ctx, {
      sessionId: study.session.id,
      operationKey: randomUUID(),
      subjectId: media.id,
      requested: amounts({}),
      request: { text: "Private synthetic provider input" },
      settings: { secretInput: "Private synthetic settings" },
      job: unusedJob,
    }),
  );
  const html = await requestHtmlExport(
    db,
    study.ctx,
    { revisionId: notebook.current.id, mediaIds: [] },
    { key: randomUUID(), settings: exportSettings },
  );
  const anki = await requestAnkiExport(
    db,
    study.ctx,
    { sessionId: study.session.id, cardIds: [card.id], tags: [], includeMedia: false },
    { key: randomUUID(), settings: exportSettings },
  );
  const job: JobContext = {
    db,
    now: () => new Date(),
    job: { id: randomUUID(), attempt: 1 },
    step: async (_name, effect) => {
      await db.transaction().execute(effect);
      return "ran";
    },
  };
  await htmlExportJob(store).run({ userId: study.ctx.userId, artifactId: html.id }, job);
  await ankiExportJob(store).run({ userId: study.ctx.userId, artifactId: anki.id }, job);
  return {
    ...study,
    course,
    unit,
    session,
    entitlementId,
    imageId,
    textId,
    media,
    card,
    notebook,
    noteKey,
    noteInput,
    runId,
    html,
    anki,
  };
}

it.each(["source", "session", "account"] as const)(
  "the actual server privacy composition cleans %s content with a captured registry predating ORG",
  async (kind) => {
    const fixtureData = await fixture();
    const other = await studyFixture(db, { count: 1 });
    const otherCard = other.cards[0];
    if (!otherCard) throw new Error("Other fixture card is missing");
    await recordItemFeedback(
      db,
      other.ctx,
      { learningItemId: otherCard.learningItemId, kind: "not_a_difficulty", active: true },
      { key: randomUUID() },
    );
    const dependencies = privacyDependencies();
    const recordJournal = vi.fn(async () => {});
    dependencies.deletionJournal = { record: recordJournal };
    const now = new Date();
    const originalGrants = await db
      .selectFrom("quota.ledger")
      .selectAll()
      .where("entitlement_id", "=", fixtureData.entitlementId)
      .where("kind", "=", "grant")
      .execute();
    let requestId: string;
    if (kind === "source") {
      await deleteSource(db, fixtureData.ctx, fixtureData.imageId, "all", now, {
        onDelete: async (tx, id, _receipt, sessions) => {
          await coordinateSourceDeletion(tx, fixtureData.ctx, id, sessions, dependencies, now);
        },
      });
      requestId = (
        await db
          .selectFrom("priv.deletion_request")
          .select("id")
          .where("user_id", "=", fixtureData.ctx.userId)
          .where("kind", "=", "source")
          .executeTakeFirstOrThrow()
      ).id;
    } else if (kind === "session")
      requestId = (
        await requestSessionDeletion(
          db,
          fixtureData.ctx,
          fixtureData.session.id,
          randomUUID(),
          dependencies,
          now,
        )
      ).id;
    else
      requestId = (
        await requestAccountDeletion(db, fixtureData.ctx, randomUUID(), dependencies, now)
      ).id;
    const captured = await db
      .selectFrom("priv.deletion_request")
      .select("modules")
      .where("id", "=", requestId)
      .executeTakeFirstOrThrow();
    expect(captured.modules).not.toContain("org");
    await expect(
      getNotebookRevision(db, fixtureData.ctx, fixtureData.notebook.current.id),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(getCard(db, fixtureData.ctx, fixtureData.card.id)).rejects.toMatchObject({
      code: "not_found",
    });
    const cached = await db
      .selectFrom("plt.idempotency_key")
      .select(["response_body", "response_status"])
      .where("user_id", "=", fixtureData.ctx.userId)
      .execute();
    expect(cached.length).toBeGreaterThan(0);
    expect(cached.every((row) => row.response_body === null && row.response_status === null)).toBe(
      true,
    );
    // A direct invocation selects only this receipt. Advance beyond every issued-link grace window.
    const job: JobContext = {
      db,
      now: () => new Date(now.getTime() + 3600000),
      job: { id: randomUUID(), attempt: 1 },
      step: async (_name, effect) => {
        await db.transaction().execute(effect);
        return "ran";
      },
    };
    await privacyCleanupJob(dependencies).run({ userId: fixtureData.ctx.userId, requestId }, job);
    expect((await getPrivacyDeletionRequest(db, fixtureData.ctx, requestId)).state).toBe(
      "completed",
    );
    expect(recordJournal).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, kind, userId: fixtureData.ctx.userId }),
    );
    expect(JSON.stringify(recordJournal.mock.calls)).not.toContain("Private synthetic");
    expect(
      await db
        .selectFrom("priv.cleanup_step")
        .select("module")
        .where("request_id", "=", requestId)
        .execute(),
    ).toHaveLength(dependencies.hooks.length);
    await expect(getVersion(db, fixtureData.ctx, fixtureData.knowledge.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getMediaAsset(db, fixtureData.ctx, fixtureData.media.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getHtmlExport(db, fixtureData.ctx, fixtureData.html.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getAnkiExport(db, fixtureData.ctx, fixtureData.anki.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      readOwnedObject(db, store, fixtureData.ctx, fixtureData.media.objectId ?? ""),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      await db
        .selectFrom("note.revision")
        .select("id")
        .where("user_id", "=", fixtureData.ctx.userId)
        .execute(),
    ).toHaveLength(0);
    expect(
      await db
        .selectFrom("card.revision")
        .select("id")
        .where("user_id", "=", fixtureData.ctx.userId)
        .execute(),
    ).toHaveLength(0);
    expect(
      await db
        .selectFrom("src.content_version")
        .select("id")
        .where("asset_id", "=", fixtureData.imageId)
        .execute(),
    ).toHaveLength(0);
    const feedbackOf = (userId: string) =>
      db.selectFrom("pers.item_feedback").select("id").where("user_id", "=", userId).execute();
    expect(await feedbackOf(fixtureData.ctx.userId)).toHaveLength(0);
    expect(await feedbackOf(other.ctx.userId)).toHaveLength(1);
    const run = await db
      .selectFrom("proc.processing_run")
      .select(["state", "input_snapshot", "settings"])
      .where("id", "=", fixtureData.runId)
      .executeTakeFirstOrThrow();
    expect(run).toEqual({ state: "cancelled", input_snapshot: {}, settings: {} });
    if (kind === "source") {
      expect((await getSource(db, fixtureData.ctx, fixtureData.textId)).display_name).toBe(
        "private.text",
      );
      expect((await getSession(db, fixtureData.ctx, fixtureData.session.id)).title).toBe(
        "Private synthetic class title",
      );
    } else {
      expect(
        await db
          .selectFrom("src.content_version")
          .select("id")
          .where("user_id", "=", fixtureData.ctx.userId)
          .execute(),
      ).toHaveLength(0);
      expect(
        await db
          .selectFrom("org.class_session")
          .select(["title", "course_id", "unit_id", sql<string>`class_date::text`.as("classDate")])
          .where("id", "=", fixtureData.session.id)
          .executeTakeFirstOrThrow(),
      ).toEqual({ title: null, course_id: null, unit_id: null, classDate: "1970-01-01" });
      expect(
        await db
          .selectFrom("org.deletion_request")
          .select("id")
          .where("session_id", "=", fixtureData.session.id)
          .execute(),
      ).toHaveLength(1);
      if (kind === "account") {
        expect(deleteIdentity).toHaveBeenCalledWith(fixtureData.ctx.userId, true);
        expect(
          await db
            .selectFrom("org.course")
            .select("id")
            .where("owner_id", "=", fixtureData.ctx.userId)
            .execute(),
        ).toHaveLength(0);
        expect(
          await db
            .selectFrom("org.unit")
            .select("id")
            .where("owner_id", "=", fixtureData.ctx.userId)
            .execute(),
        ).toHaveLength(0);
      }
    }
    if (kind !== "account") {
      expect(
        await db
          .selectFrom("org.course")
          .select("name")
          .where("id", "=", fixtureData.course.id)
          .executeTakeFirstOrThrow(),
      ).toEqual({ name: "Private synthetic course name" });
      expect(
        await db
          .selectFrom("org.unit")
          .select("name")
          .where("id", "=", fixtureData.unit.id)
          .executeTakeFirstOrThrow(),
      ).toEqual({ name: "Private synthetic unit name" });
    }
    expect((await getNotebookRevision(db, other.ctx, other.notebook.current.id)).id).toBe(
      other.notebook.current.id,
    );
    expect((await getSession(db, other.ctx, other.session.id)).courseId).toBe(
      other.session.courseId,
    );
    expect(
      await db
        .selectFrom("quota.ledger")
        .selectAll()
        .where("entitlement_id", "=", fixtureData.entitlementId)
        .where("kind", "=", "grant")
        .execute(),
    ).toEqual(originalGrants);
  },
  60000,
);
it("a concurrent class deletion waits for MEDIA signing and schedules cleanup after its private link expires", async () => {
  const data = await fixture();
  let reached!: () => void;
  let release!: () => void;
  const signing = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const signRead = store.signRead.bind(store);
  const spy = vi.spyOn(store, "signRead").mockImplementation(async (key, expires) => {
    reached();
    await barrier;
    return signRead(key, expires);
  });
  try {
    const issued = mediaReadLink(db, store, data.ctx, data.media.id, DEFAULT_PLT_SETTINGS.storage);
    await signing;
    let tombstoned = false;
    const deletion = requestSessionDeletion(
      db,
      data.ctx,
      data.session.id,
      randomUUID(),
      privacyDependencies(),
    ).then((receipt) => {
      tombstoned = true;
      return receipt;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tombstoned).toBe(false);
    release();
    const link = await issued;
    const receipt = await deletion;
    await expect(
      mediaReadLink(db, store, data.ctx, data.media.id, DEFAULT_PLT_SETTINGS.storage),
    ).rejects.toMatchObject({ code: "not_found" });
    const request = await db
      .selectFrom("priv.deletion_request")
      .select("job_id")
      .where("id", "=", receipt.id)
      .executeTakeFirstOrThrow();
    if (!request.job_id) throw new Error("Privacy cleanup job was not queued");
    const job = await db
      .selectFrom("plt.job")
      .select("run_at")
      .where("id", "=", request.job_id)
      .executeTakeFirstOrThrow();
    expect(job.run_at.getTime()).toBeGreaterThanOrEqual(new Date(link.validUntil).getTime());
  } finally {
    release();
    spy.mockRestore();
  }
}, 60000);
