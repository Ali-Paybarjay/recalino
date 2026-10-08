import { randomBytes, randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { getNotebook } from "@recalino/core/note";
import {
  appendEncryptedDeletionJournal,
  backupEncryptionKey,
  createDatabaseBackup,
  decryptBackupArchive,
  readDatabaseBackup,
  readEncryptedDeletionJournals,
} from "@recalino/core/ops";
import { createSession, getSession } from "@recalino/core/org";
import { MemoryObjectStore, sha256Hex } from "@recalino/core/plt";
import { acceptSourceNotice, createSource, getSource } from "@recalino/core/src";
import { sql } from "kysely";
import { expect, it } from "vitest";
import { studyFixture } from "../../core/test/study-fixture";
import { isolatedRestoreDrill, nativeDatabaseDump } from "./backup-native";
import { replayRestoredDeletionJournals } from "./backup-replay";

// This integration explicitly opts into installed local Docker/PostgreSQL tools. No cloud URL is accepted.
it.skipIf(process.env.RUN_NATIVE_BACKUP_DRILL !== "1")(
  "encrypts an actual local pg_dump archive and restores an isolated local database with validated constraints",
  async () => {
    const url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    const app = createDatabase(
      "postgresql://recalino_app:recalino-local-only@127.0.0.1:54322/postgres",
      { maxConnections: 3 },
    );
    const tools = { mode: "docker" as const, container: "supabase_db_recalino" };
    const key = backupEncryptionKey(randomBytes(32).toString("base64")),
      store = new MemoryObjectStore();
    const operator = {
      actorId: "synthetic-native-drill",
      reason: "Local synthetic archive and isolated restore verification",
    };
    try {
      const sessionOwner = await studyFixture(app),
        sourceOwner = await studyFixture(app),
        accountOwner = await studyFixture(app),
        survivingOwner = await studyFixture(app);
      await acceptSourceNotice(app, sourceOwner.ctx, "0.1", true);
      const audio = new Uint8Array([0x49, 0x44, 0x33]);
      const source = await createSource(app, sourceOwner.ctx, {
        sessionId: sourceOwner.session.id,
        kind: "audio",
        mimeType: "audio/mpeg",
        sizeBytes: audio.length,
        sha256: sha256Hex(audio),
        displayName: "Synthetic restore audio",
        durationMs: 3000,
        parts: [],
        operationKey: randomUUID(),
      });
      const saved = await createDatabaseBackup(app, store, nativeDatabaseDump(tools, url, 120), {
        settings: {
          version: "1",
          keyId: "synthetic-drill",
          maxEncryptedBytes: 64 * 1024 * 1024,
          timeoutSeconds: 120,
        },
        key,
        operationKey: randomUUID(),
        operator,
      });
      const encrypted = await readDatabaseBackup(app, store, saved.id, operator);
      const archive = decryptBackupArchive(encrypted.ciphertext, key, encrypted.keyId);
      // These subjects were created after the captured archive, so replay must skip them entirely.
      const absentAccount = await studyFixture(app);
      const absentSession = await createSession(app, survivingOwner.ctx, {}, { key: randomUUID() });
      await acceptSourceNotice(app, survivingOwner.ctx, "0.1", true);
      const absentSource = await createSource(app, survivingOwner.ctx, {
        sessionId: survivingOwner.session.id,
        kind: "audio",
        mimeType: "audio/mpeg",
        sizeBytes: audio.length,
        sha256: sha256Hex(audio),
        displayName: "Post-snapshot synthetic source",
        durationMs: 3000,
        parts: [],
        operationKey: randomUUID(),
      });
      const requestedAt = new Date().toISOString();
      for (const entry of [
        {
          requestId: randomUUID(),
          userId: sessionOwner.ctx.userId,
          kind: "session",
          subjectId: sessionOwner.session.id,
          relatedSessions: [],
          requestedAt,
        },
        {
          requestId: randomUUID(),
          userId: absentAccount.ctx.userId,
          kind: "account",
          subjectId: absentAccount.ctx.userId,
          relatedSessions: [],
          requestedAt,
        },
        {
          requestId: randomUUID(),
          userId: survivingOwner.ctx.userId,
          kind: "session",
          subjectId: absentSession.id,
          relatedSessions: [],
          requestedAt,
        },
        {
          requestId: randomUUID(),
          userId: survivingOwner.ctx.userId,
          kind: "source",
          subjectId: absentSource.assetId,
          relatedSessions: [survivingOwner.session.id],
          requestedAt,
        },
        {
          requestId: randomUUID(),
          userId: sourceOwner.ctx.userId,
          kind: "source",
          subjectId: source.assetId,
          relatedSessions: [sourceOwner.session.id],
          requestedAt,
        },
        {
          requestId: randomUUID(),
          userId: accountOwner.ctx.userId,
          kind: "account",
          subjectId: accountOwner.ctx.userId,
          relatedSessions: [],
          requestedAt,
        },
      ])
        await appendEncryptedDeletionJournal(app, store, { keyId: "synthetic-drill", key }, entry);
      const journals = await readEncryptedDeletionJournals(
        store,
        new Map([["synthetic-drill", key]]),
      );
      let restoredName: string | undefined;
      try {
        const result = await isolatedRestoreDrill(tools, url, archive, 120, async (isolatedUrl) => {
          restoredName = new URL(isolatedUrl).pathname.slice(1);
          const restored = createDatabase(isolatedUrl, { maxConnections: 1 });
          try {
            expect((await getSession(restored, sessionOwner.ctx, sessionOwner.session.id)).id).toBe(
              sessionOwner.session.id,
            );
            expect((await getSource(restored, sourceOwner.ctx, source.assetId)).id).toBe(
              source.assetId,
            );
            for (const foreign of [
              { kind: "session" as const, subjectId: sessionOwner.session.id, relatedSessions: [] },
              {
                kind: "source" as const,
                subjectId: source.assetId,
                relatedSessions: [sourceOwner.session.id],
              },
            ])
              await expect(
                replayRestoredDeletionJournals(isolatedUrl, [
                  {
                    requestId: randomUUID(),
                    userId: survivingOwner.ctx.userId,
                    requestedAt,
                    ...foreign,
                  },
                ]),
              ).rejects.toMatchObject({ code: "not_found" });
            const repeated = [...journals, ...journals];
            expect(await replayRestoredDeletionJournals(isolatedUrl, repeated)).toMatchObject({
              entries: 12,
              uniqueEntries: 6,
            });
            // Replay can be retried after an interrupted recovery, with no external cleanup.
            expect(await replayRestoredDeletionJournals(isolatedUrl, repeated)).toMatchObject({
              entries: 12,
              uniqueEntries: 6,
            });
            await expect(
              getSession(restored, sessionOwner.ctx, sessionOwner.session.id),
            ).rejects.toMatchObject({ code: "not_found" });
            expect(
              (await getSession(restored, survivingOwner.ctx, survivingOwner.session.id)).id,
            ).toBe(survivingOwner.session.id);
            expect(
              (await getNotebook(restored, survivingOwner.ctx, survivingOwner.session.id))?.current
                .id,
            ).toBe(survivingOwner.notebook.current.id);
            await expect(
              getSource(restored, sourceOwner.ctx, source.assetId),
            ).rejects.toMatchObject({ code: "not_found" });
            await expect(
              getSession(restored, accountOwner.ctx, accountOwner.session.id),
            ).rejects.toMatchObject({ code: "not_found" });
          } finally {
            await restored.destroy();
          }
        });
        expect(result.tables).toBeGreaterThan(30);
        expect(result.constraintsValidated).toBe(true);
        expect(result.publicServiceOpened).toBe(false);
        const original = createDatabase(url, { maxConnections: 1 });
        try {
          const leftover = await sql<{
            count: string;
          }>`select count(*)::text as count from pg_catalog.pg_database where datname=${restoredName ?? ""}`.execute(
            original,
          );
          expect(leftover.rows[0]?.count).toBe("0");
        } finally {
          await original.destroy();
        }
      } finally {
        archive.fill(0);
      }
    } finally {
      key.fill(0);
      await app.destroy();
    }
  },
  180000,
);
