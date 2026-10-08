import "server-only";
import {
  cleanupAnkiExports,
  tombstoneAccountAnkiExports,
  tombstoneSessionAnkiExports,
} from "@recalino/core/anki";
import {
  cleanupAccountCards,
  cleanupSessionCards,
  tombstoneAccountCards,
  tombstoneSessionCards,
  tombstoneSourceCards,
} from "@recalino/core/card";
import type { Database } from "@recalino/core/db";
import {
  cleanupHtmlExports,
  tombstoneAccountHtmlExports,
  tombstoneSessionHtmlExports,
} from "@recalino/core/html";
import {
  cleanupAccountKnowledge,
  cleanupSessionKnowledge,
  tombstoneAccountKnowledge,
  tombstoneKnowledge,
} from "@recalino/core/lkm";
import {
  cleanupAccountMedia,
  cleanupSessionMedia,
  cleanupSourceMedia,
  tombstoneAccountMedia,
  tombstoneSessionMedia,
  tombstoneSourceMedia,
} from "@recalino/core/media";
import {
  cleanupAccountNotes,
  cleanupSessionNotes,
  cleanupSourceNotes,
  tombstoneAccountNotes,
  tombstoneSessionNotes,
  tombstoneSourceNotes,
} from "@recalino/core/note";
import {
  clearAccountNotifications,
  clearSessionNotifications,
  errors,
  type LearnerContext,
} from "@recalino/core/plt";
import { type PrivacyDependencies, privacyCleanupJob } from "@recalino/core/priv";
import {
  cleanupAccountProcessing,
  cleanupSessionProcessing,
  cleanupSourceProcessing,
} from "@recalino/core/proc";
import {
  cleanupAccountSources,
  cleanupDeletedSource,
  cleanupSessionSources,
  tombstoneAccountSources,
  tombstoneSessionSources,
} from "@recalino/core/src";
import {
  cleanupAccountSrs,
  cleanupSessionSrs,
  tombstoneAccountSrs,
  tombstoneSessionSrs,
} from "@recalino/core/srs";
import { purgeSupportUser } from "@recalino/core/support";
import {
  cleanupAccountVoice,
  removeSessionVoice,
  removeSourceVoice,
  revokeVoiceData,
} from "@recalino/core/voc";
import { createAuthAdmin } from "./auth/supabase";
import { privacyDeletionJournal } from "./privacy-journal";
import { getObjectStore } from "./storage";

function storage() {
  const store = getObjectStore();
  if (!store) throw errors.validationFailed({ cleanup: ["storage_adapter_missing"] });
  return store;
}
async function removeIdentity(userId: string) {
  // Supabase soft deletion sanitizes the identity and removes all sessions, preserving the
  // account FK for append-only financial audit records. Repeating it is idempotent.
  const { error } = await createAuthAdmin().deleteUser(userId, true);
  if (error && error.status !== 404) throw new Error("Authentication cleanup failed");
}
async function withdrawExports(db: Database, ctx: LearnerContext, now?: Date) {
  await db.transaction().execute((tx) => tombstoneAccountHtmlExports(tx, ctx, now));
  await cleanupHtmlExports(db, storage(), ctx, { now });
}
export function privacyDependencies(): PrivacyDependencies {
  return {
    authentication: { revokeSessions: removeIdentity, deleteIdentity: removeIdentity },
    deletionJournal: privacyDeletionJournal(),
    hooks: [
      {
        module: "plt",
        tombstoneSession: clearSessionNotifications,
        tombstoneAccount: clearAccountNotifications,
        cleanupSession: clearSessionNotifications,
        cleanupAccount: clearAccountNotifications,
      },
      {
        module: "voc",
        // Deleting a reference's class withdraws automatic matches elsewhere; exports that
        // showed their spoken mistakes are withdrawn with them, as on a manual revoke.
        tombstoneSession: async (tx, ctx, id, now) => {
          if (await removeSessionVoice(tx, ctx, id))
            await tombstoneAccountHtmlExports(tx, ctx, now);
        },
        tombstoneAccount: revokeVoiceData,
        tombstoneSource: async (tx, ctx, id, _sessions, now) => {
          if (await removeSourceVoice(tx, ctx, id)) await tombstoneAccountHtmlExports(tx, ctx, now);
        },
        cleanupSession: async (db, ctx, id, now) => {
          if (await removeSessionVoice(db, ctx, id)) await withdrawExports(db, ctx, now);
        },
        cleanupSource: async (db, ctx, id, _sessions, now) => {
          if (await removeSourceVoice(db, ctx, id)) await withdrawExports(db, ctx, now);
        },
        cleanupAccount: (db, ctx, now) => cleanupAccountVoice(db, storage(), ctx, now),
      },
      {
        module: "support",
        tombstoneSession: async () => {},
        cleanupSession: async () => {},
        cleanupAccount: (db, ctx) => purgeSupportUser(db, ctx.userId),
      },
      {
        module: "html",
        tombstoneSession: tombstoneSessionHtmlExports,
        tombstoneAccount: tombstoneAccountHtmlExports,
        tombstoneSource: async (tx, ctx, _, ids, now) => {
          for (const id of ids) await tombstoneSessionHtmlExports(tx, ctx, id, now);
        },
        cleanupSession: (db, ctx, sessionId, now) =>
          cleanupHtmlExports(db, storage(), ctx, { sessionId, now }),
        cleanupAccount: (db, ctx, now) => cleanupHtmlExports(db, storage(), ctx, { now }),
        cleanupSource: async (db, ctx, _, ids, now) => {
          for (const sessionId of ids)
            await cleanupHtmlExports(db, storage(), ctx, { sessionId, now });
        },
      },
      {
        module: "anki",
        tombstoneSession: tombstoneSessionAnkiExports,
        tombstoneAccount: tombstoneAccountAnkiExports,
        tombstoneSource: async (tx, ctx, _, ids, now) => {
          for (const id of ids) await tombstoneSessionAnkiExports(tx, ctx, id, now);
        },
        cleanupSession: (db, ctx, sessionId, now) =>
          cleanupAnkiExports(db, storage(), ctx, { sessionId, now }),
        cleanupAccount: (db, ctx, now) => cleanupAnkiExports(db, storage(), ctx, { now }),
        cleanupSource: async (db, ctx, _, ids, now) => {
          for (const sessionId of ids)
            await cleanupAnkiExports(db, storage(), ctx, { sessionId, now });
        },
      },
      {
        module: "proc",
        tombstoneSession: async () => {},
        cleanupSession: (db, ctx, sessionId, now) =>
          cleanupSessionProcessing(db, ctx, sessionId, { store: storage(), now }),
        cleanupAccount: (db, ctx, now) =>
          cleanupAccountProcessing(db, ctx, { store: storage(), now }),
        cleanupSource: (db, ctx, sourceId, _ids, now) =>
          cleanupSourceProcessing(db, ctx, sourceId, { store: storage(), now }),
      },
      {
        module: "srs",
        tombstoneSession: tombstoneSessionSrs,
        tombstoneAccount: tombstoneAccountSrs,
        cleanupSession: cleanupSessionSrs,
        cleanupAccount: cleanupAccountSrs,
      },
      {
        module: "card",
        tombstoneSession: tombstoneSessionCards,
        tombstoneAccount: tombstoneAccountCards,
        tombstoneSource: (tx, ctx, sourceId, ids, now) =>
          tombstoneSourceCards(tx, ctx, sourceId, [...ids], now),
        cleanupSession: cleanupSessionCards,
        cleanupAccount: cleanupAccountCards,
        cleanupSource: async (db, ctx, _, ids) => {
          for (const id of ids) await cleanupSessionCards(db, ctx, id);
        },
      },
      {
        module: "note",
        tombstoneSession: tombstoneSessionNotes,
        tombstoneAccount: tombstoneAccountNotes,
        tombstoneSource: (tx, ctx, sourceId, ids) =>
          tombstoneSourceNotes(tx, ctx, sourceId, [...ids]),
        cleanupSession: cleanupSessionNotes,
        cleanupAccount: cleanupAccountNotes,
        cleanupSource: async (db, ctx, _, ids) => {
          for (const id of ids) await cleanupSourceNotes(db, ctx, id);
        },
      },
      {
        module: "lkm",
        tombstoneSession: tombstoneKnowledge,
        tombstoneAccount: tombstoneAccountKnowledge,
        tombstoneSource: async (tx, ctx, _, ids, now) => {
          for (const id of ids) await tombstoneKnowledge(tx, ctx, id, now);
        },
        cleanupSession: cleanupSessionKnowledge,
        cleanupAccount: cleanupAccountKnowledge,
        cleanupSource: async (db, ctx, _, ids) => {
          for (const id of ids) await cleanupSessionKnowledge(db, ctx, id);
        },
      },
      {
        module: "media",
        tombstoneSession: tombstoneSessionMedia,
        tombstoneAccount: tombstoneAccountMedia,
        tombstoneSource: (tx, ctx, id, ids, now) => tombstoneSourceMedia(tx, ctx, id, now, ids),
        cleanupSession: (db, ctx, id, now) => cleanupSessionMedia(db, storage(), ctx, id, now),
        cleanupAccount: (db, ctx, now) => cleanupAccountMedia(db, storage(), ctx, now),
        cleanupSource: (db, ctx, id, ids, now) =>
          cleanupSourceMedia(db, storage(), ctx, id, now, ids),
      },
      {
        module: "src",
        tombstoneSession: tombstoneSessionSources,
        tombstoneAccount: tombstoneAccountSources,
        cleanupSession: (db, ctx, id, now) => cleanupSessionSources(db, storage(), ctx, id, now),
        cleanupAccount: (db, ctx, now) => cleanupAccountSources(db, storage(), ctx, now),
        cleanupSource: (db, ctx, id, _, now) => cleanupDeletedSource(db, storage(), ctx, id, now),
      },
    ],
  };
}
export function getPrivacyJobDefinition() {
  return privacyCleanupJob(privacyDependencies());
}
