import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { studyFixture } from "../../test/study-fixture";
import { getCard } from "../card";
import { createDatabase, type Database } from "../db";
import { MemoryObjectStore } from "../plt";
import { ankiExportJob, getAnkiExport, requestAnkiExport } from "./exports";

// PERF-04: checking and building an Anki export reads its cards in a number of queries that does
// not grow with them; the request still locks its cards one getCard after another and copies
// exactly what one getCard per card reads.
const db = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
// A second connection, to see which rows an open export request holds locked.
const probe = createDatabase(testDatabaseUrl(), { maxConnections: 1 });
afterAll(() => Promise.all([db.destroy(), probe.destroy()]));
const settings = { version: "test-1", maxBytes: 5_000_000, maxItems: 1000, retentionSeconds: 3600 };

function countingDatabase(database: Database) {
  let count = 0;
  const counted = database.withPlugin({
    transformQuery(args) {
      count++;
      return args.node;
    },
    async transformResult(args) {
      return args.result;
    },
  });
  return { db: counted, queries: () => count };
}

it("PERF-04 checks and builds an Anki export in queries that do not grow with its cards", async () => {
  const counts: number[][] = [];
  for (const size of [5, 50]) {
    const x = await studyFixture(db, { count: size });
    const ids = x.cards.map((card) => card.id);
    const input = {
      sessionId: x.session.id,
      cardIds: ids,
      tags: ["synthetic"],
      includeMedia: false,
    };
    const request = countingDatabase(db);
    const artifact = await requestAnkiExport(request.db, x.ctx, input, {
      key: randomUUID(),
      settings,
    });
    const read = countingDatabase(db);
    expect((await getAnkiExport(read.db, x.ctx, artifact.id)).id).toBe(artifact.id);
    const build = countingDatabase(db);
    await ankiExportJob(new MemoryObjectStore()).run(
      { userId: x.ctx.userId, artifactId: artifact.id },
      {
        db: build.db,
        now: () => new Date(),
        job: { id: randomUUID(), attempt: 1 },
        step: async () => "ran",
      },
    );
    expect((await getAnkiExport(db, x.ctx, artifact.id)).state).toBe("ready");
    // One locked getCard per card: the request's reads still grow with its cards.
    expect(request.queries()).toBeGreaterThan(size * 3);
    counts.push([read.queries(), build.queries()]);
    // The copied cards are what one getCard per card returns, in the learner's order.
    const row = await db
      .selectFrom("anki.export_artifact")
      .select("snapshot")
      .where("id", "=", artifact.id)
      .executeTakeFirstOrThrow();
    const expected = [];
    for (const id of ids) {
      const card = await getCard(db, x.ctx, id);
      expected.push({
        id: card.id,
        template: card.template,
        direction: card.direction,
        front: card.front,
        back: card.back,
        ...(card.contentFormat === undefined ? {} : { contentFormat: card.contentFormat }),
        ...(card.studySet === undefined ? {} : { studySet: card.studySet }),
        ...(card.studyTags === undefined ? {} : { studyTags: card.studyTags }),
        provenance: card.provenance,
        contentVersion: card.contentVersion,
        frontMediaId: null,
        backMediaId: null,
      });
    }
    expect((row.snapshot as { cards: unknown[] }).cards).toEqual(expected);
  }
  expect(counts[1]).toEqual(counts[0]);
});

it("PERF-04 reports the first selected card's problem first, as one read per card did", async () => {
  const x = await studyFixture(db, { count: 2 });
  const [first, second] = x.cards;
  if (!first || !second) throw new Error("fixture");
  await db
    .updateTable("card.card")
    .set({ deleted_at: new Date(), status: "deleted", updated_at: new Date() })
    .where("id", "=", second.id)
    .execute();
  const request = (cardIds: string[]) => ({
    sessionId: x.session.id,
    cardIds,
    tags: [],
    includeMedia: false,
    expectedVersions: { [first.id]: first.contentVersion + 1, [second.id]: second.contentVersion },
  });
  await expect(
    requestAnkiExport(db, x.ctx, request([first.id, second.id]), { key: randomUUID(), settings }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    requestAnkiExport(db, x.ctx, request([second.id, first.id]), { key: randomUUID(), settings }),
  ).rejects.toMatchObject({ code: "not_found" });
  const other = await studyFixture(db, { count: 1 });
  await expect(
    requestAnkiExport(
      db,
      other.ctx,
      { sessionId: other.session.id, cardIds: [first.id], tags: [], includeMedia: false },
      { key: randomUUID(), settings },
    ),
  ).rejects.toMatchObject({ code: "not_found", securitySignal: "ownership_denied" });
});

it("PERF-04 keeps every selected card locked until the export request ends", async () => {
  const x = await studyFixture(db, { count: 3 });
  const [first, second, other] = x.cards;
  if (!first || !second || !other) throw new Error("fixture");
  // Asks for a card's row lock without waiting; 55P03 means another transaction holds it.
  const lockNow = (id: string) =>
    probe.selectFrom("card.card").select("id").where("id", "=", id).forUpdate().noWait().execute();
  let checked = false;
  await requestAnkiExport(
    db,
    x.ctx,
    { sessionId: x.session.id, cardIds: [second.id, first.id], tags: [], includeMedia: false },
    {
      key: randomUUID(),
      settings,
      onCreated: async () => {
        for (const id of [second.id, first.id])
          await expect(lockNow(id)).rejects.toMatchObject({ code: "55P03" });
        // A card the learner did not select is not locked.
        expect(await lockNow(other.id)).toHaveLength(1);
        checked = true;
      },
    },
  );
  expect(checked).toBe(true);
  // The locks end with the request's transaction.
  for (const id of [first.id, second.id]) expect(await lockNow(id)).toHaveLength(1);
});
