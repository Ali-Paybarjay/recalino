import type { Database } from "../db";
import { assertOwner, errors, type LearnerContext, type ObjectStore } from "../plt";
import { maintainSources } from "./jobs";
import { cleanupSourceContent } from "./service";

async function cleanup(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  ids: string[],
  now: Date,
): Promise<void> {
  if (!ids.length) return;
  const assets = await db
    .selectFrom("src.asset")
    .select(["id", "user_id", "tombstoned_at"])
    .where("id", "in", ids)
    .execute();
  for (const id of ids) {
    const row = assets.find((a) => a.id === id);
    assertOwner(row ? { ownerId: row.user_id } : undefined, ctx);
    if (!row?.tombstoned_at) throw errors.conflict();
  }
  // Each relevant object is deleted before content cleanup can report success.
  await maintainSources(db, store, now, { userId: ctx.userId, assetIds: ids });
  await cleanupSourceContent(db, ctx, ids);
}
export async function cleanupDeletedSource(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  sourceId: string,
  now = new Date(),
): Promise<void> {
  await cleanup(db, store, ctx, [sourceId], now);
}
export async function cleanupSessionSources(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  sessionId: string,
  now = new Date(),
): Promise<void> {
  const links = await db
    .selectFrom("src.session_source")
    .innerJoin("src.asset", "src.asset.id", "src.session_source.asset_id")
    .select("src.asset.id")
    .where("src.session_source.user_id", "=", ctx.userId)
    .where("src.session_source.session_id", "=", sessionId)
    .where("src.asset.tombstoned_at", "is not", null)
    .execute();
  await cleanup(
    db,
    store,
    ctx,
    links.map((r) => r.id),
    now,
  );
  await db
    .deleteFrom("src.source_snapshot")
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .execute();
  await db
    .deleteFrom("src.session_source")
    .where("user_id", "=", ctx.userId)
    .where("session_id", "=", sessionId)
    .where("active", "=", false)
    .execute();
}
export async function cleanupAccountSources(
  db: Database,
  store: ObjectStore,
  ctx: LearnerContext,
  now = new Date(),
): Promise<void> {
  const assets = await db
    .selectFrom("src.asset")
    .select("id")
    .where("user_id", "=", ctx.userId)
    .where("tombstoned_at", "is not", null)
    .execute();
  await cleanup(
    db,
    store,
    ctx,
    assets.map((r) => r.id),
    now,
  );
  await db.deleteFrom("src.source_snapshot").where("user_id", "=", ctx.userId).execute();
  await db
    .deleteFrom("src.session_source")
    .where("user_id", "=", ctx.userId)
    .where("active", "=", false)
    .execute();
}
