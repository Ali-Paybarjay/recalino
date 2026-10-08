import {
  tombstoneAccountAnkiExports,
  tombstoneSessionAnkiExports,
  tombstoneSourceAnkiExports,
} from "@recalino/core/anki";
import {
  tombstoneAccountCards,
  tombstoneSessionCards,
  tombstoneSourceCards,
} from "@recalino/core/card";
import { createDatabase, databaseTls } from "@recalino/core/db";
import {
  tombstoneAccountHtmlExports,
  tombstoneSessionHtmlExports,
  tombstoneSourceHtmlExports,
} from "@recalino/core/html";
import { tombstoneAccountKnowledge, tombstoneKnowledge } from "@recalino/core/lkm";
import {
  tombstoneAccountMedia,
  tombstoneSessionMedia,
  tombstoneSourceMedia,
} from "@recalino/core/media";
import {
  tombstoneAccountNotes,
  tombstoneSessionNotes,
  tombstoneSourceNotes,
} from "@recalino/core/note";
import type { DeletionJournal } from "@recalino/core/ops";
import { type PrivacyHook, replayDeletionJournals } from "@recalino/core/priv";
import {
  tombstoneAccountSources,
  tombstoneSessionSources,
  tombstoneSourceForReplay,
} from "@recalino/core/src";
import { tombstoneAccountSrs, tombstoneSessionSrs } from "@recalino/core/srs";

async function forbiddenCleanup() {
  throw new Error("restore_physical_cleanup_forbidden");
}
const hooks: Omit<PrivacyHook, "cleanupAccount">[] = [
  {
    module: "html",
    tombstoneAccount: tombstoneAccountHtmlExports,
    tombstoneSession: tombstoneSessionHtmlExports,
    tombstoneSource: (tx, ctx, id, sessions, now) =>
      tombstoneSourceHtmlExports(tx, ctx, id, [...sessions], now),
    cleanupSession: forbiddenCleanup,
  },
  {
    module: "anki",
    tombstoneAccount: tombstoneAccountAnkiExports,
    tombstoneSession: tombstoneSessionAnkiExports,
    tombstoneSource: (tx, ctx, id, sessions, now) =>
      tombstoneSourceAnkiExports(tx, ctx, id, [...sessions], now),
    cleanupSession: forbiddenCleanup,
  },
  {
    module: "srs",
    tombstoneAccount: tombstoneAccountSrs,
    tombstoneSession: tombstoneSessionSrs,
    cleanupSession: forbiddenCleanup,
  },
  {
    module: "card",
    tombstoneAccount: tombstoneAccountCards,
    tombstoneSession: tombstoneSessionCards,
    tombstoneSource: (tx, ctx, id, sessions, now) =>
      tombstoneSourceCards(tx, ctx, id, [...sessions], now),
    cleanupSession: forbiddenCleanup,
  },
  {
    module: "note",
    tombstoneAccount: tombstoneAccountNotes,
    tombstoneSession: tombstoneSessionNotes,
    tombstoneSource: (tx, ctx, id, sessions) => tombstoneSourceNotes(tx, ctx, id, [...sessions]),
    cleanupSession: forbiddenCleanup,
  },
  {
    module: "lkm",
    tombstoneAccount: tombstoneAccountKnowledge,
    tombstoneSession: tombstoneKnowledge,
    tombstoneSource: async (tx, ctx, _, sessions, now) => {
      for (const id of sessions) await tombstoneKnowledge(tx, ctx, id, now);
    },
    cleanupSession: forbiddenCleanup,
  },
  {
    module: "media",
    tombstoneAccount: tombstoneAccountMedia,
    tombstoneSession: tombstoneSessionMedia,
    tombstoneSource: (tx, ctx, id, sessions, now) =>
      tombstoneSourceMedia(tx, ctx, id, now, sessions),
    cleanupSession: forbiddenCleanup,
  },
  {
    module: "src",
    tombstoneAccount: tombstoneAccountSources,
    tombstoneSession: tombstoneSessionSources,
    tombstoneSource: async (tx, ctx, id, sessions, now) => {
      await tombstoneSourceForReplay(tx, ctx, id, [...sessions], now);
    },
    cleanupSession: forbiddenCleanup,
  },
];
/** Offline tombstone replay uses no app environment, authentication service, Blob SDK or AI adapter. */
export async function replayRestoredDeletionJournals(
  localUrl: string,
  journals: DeletionJournal[],
) {
  if (databaseTls(localUrl, {}) !== false) throw new Error("restore_local_target_required");
  const db = createDatabase(localUrl, { maxConnections: 2 });
  try {
    return await replayDeletionJournals(
      db,
      journals,
      { hooks: hooks.map((hook) => ({ ...hook, cleanupAccount: forbiddenCleanup })) },
      { disposableLocal: true },
    );
  } finally {
    await db.destroy();
  }
}
