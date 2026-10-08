import { sql } from "kysely";
import { z } from "zod";
import { lockAccountForCleanup, tombstoneAccount } from "../acc";
import type { Database } from "../db";
import { listSessions, tombstoneRestoredSession } from "../org";
import { canonicalJson, errors, redactUserIdempotencyResponses } from "../plt";
import { cancelAccountRuns, cancelSessionRuns, markSourceProcessingForCleanup } from "../proc";
import { tombstoneSourceForReplay } from "../src";
import type { DeletionJournalEntry, PrivacyDependencies } from "./deletion";

export const deletionJournalEntrySchema = z.strictObject({
  requestId: z.uuid(),
  userId: z.uuid(),
  kind: z.enum(["session", "account", "source"]),
  subjectId: z.uuid(),
  relatedSessions: z.array(z.uuid()).max(10000),
  requestedAt: z.iso.datetime(),
});
/** Authenticated journal replay in an offline disposable restore; never runs cleanup/auth/Blob/AI. */
export async function replayDeletionJournals(
  db: Database,
  raw: readonly DeletionJournalEntry[],
  dependencies: Pick<PrivacyDependencies, "hooks">,
  options: { disposableLocal: true },
): Promise<{ entries: number; uniqueEntries: number }> {
  if (options.disposableLocal !== true)
    throw errors.validationFailed({ recovery: ["disposable_local_required"] });
  const database = (
    await sql<{ database: string }>`select current_database() as database`.execute(db)
  ).rows[0]?.database;
  if (!database || !/^recalino_restore_[0-9a-f]{32}$/.test(database))
    throw errors.validationFailed({ recovery: ["disposable_local_required"] });
  const entries = z.array(deletionJournalEntrySchema).max(100000).parse(raw);
  const requests = new Map<string, { entry: DeletionJournalEntry; hash: string }>();
  // Validate the complete journal batch before altering restored visibility. Conflicting
  // receipts must never silently choose whichever encrypted object was listed first.
  for (const entry of entries) {
    if (entry.kind === "account" && entry.subjectId !== entry.userId)
      throw errors.validationFailed({ recovery: ["account_subject_mismatch"] });
    const hash = canonicalJson(entry);
    const previous = requests.get(entry.requestId);
    if (previous && previous.hash !== hash)
      throw errors.validationFailed({ recovery: ["journal_request_conflict"] });
    requests.set(entry.requestId, { entry, hash });
  }
  for (const { entry } of [...requests.values()].sort((a, b) =>
    a.entry.requestedAt.localeCompare(b.entry.requestedAt),
  )) {
    const ctx = { userId: entry.userId, requestId: entry.requestId };
    const now = new Date(entry.requestedAt);
    await db.transaction().execute(async (tx) => {
      const accountExists = await lockAccountForCleanup(tx, ctx.userId);
      await redactUserIdempotencyResponses(tx, ctx.userId);
      if (entry.kind === "account") {
        if (!accountExists) return;
        for (;;) {
          const { items } = await listSessions(tx, ctx, { limit: 100 });
          if (!items.length) break;
          for (const session of items) {
            await tombstoneRestoredSession(tx, ctx, session.id, now);
            await cancelSessionRuns(tx, ctx, session.id, now);
            for (const hook of dependencies.hooks)
              await hook.tombstoneSession(tx, ctx, session.id, now);
          }
        }
        await cancelAccountRuns(tx, ctx, now);
        for (const hook of dependencies.hooks) await hook.tombstoneAccount?.(tx, ctx, now);
        await tombstoneAccount(tx, ctx, now);
      } else if (entry.kind === "session") {
        if (!(await tombstoneRestoredSession(tx, ctx, entry.subjectId, now))) return;
        await cancelSessionRuns(tx, ctx, entry.subjectId, now);
        for (const hook of dependencies.hooks)
          await hook.tombstoneSession(tx, ctx, entry.subjectId, now);
      } else {
        if (
          !(await tombstoneSourceForReplay(
            tx,
            ctx,
            entry.subjectId,
            [...entry.relatedSessions],
            now,
          ))
        )
          return;
        for (const sessionId of entry.relatedSessions)
          await cancelSessionRuns(tx, ctx, sessionId, now);
        await markSourceProcessingForCleanup(tx, ctx, entry.subjectId, entry.relatedSessions, now);
        for (const hook of dependencies.hooks)
          await hook.tombstoneSource?.(tx, ctx, entry.subjectId, entry.relatedSessions, now);
      }
    });
  }
  return { entries: entries.length, uniqueEntries: requests.size };
}
