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
  cleanupAccountPers,
  cleanupSessionPers,
  tombstoneAccountPers,
  tombstoneSessionPers,
} from "@recalino/core/pers";
import { clearAccountNotifications, clearSessionNotifications, errors } from "@recalino/core/plt";
import { type PrivacyDependencies, privacyCleanupJob } from "@recalino/core/priv";
import {
  cleanupAccountProcessing,
  cleanupSessionProcessing,
  cleanupSourceProcessing,
  forgetPracticeSources,
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
        tombstoneSession: (tx, ctx, id) => removeSessionVoice(tx, ctx, id),
        tombstoneAccount: revokeVoiceData,
        tombstoneSource: (tx, ctx, id) => removeSourceVoice(tx, ctx, id),
        cleanupSession: (db, ctx, id) => removeSessionVoice(db, ctx, id),
        cleanupSource: (db, ctx, id) => removeSourceVoice(db, ctx, id),
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
        // D49: memory points copied from the deleted class leave other classes' snapshots and
        // lesson records at once; cleanup repeats it for a run created in between.
        tombstoneSession: (tx, ctx, sessionId) => forgetPracticeSources(tx, ctx, [sessionId]),
        tombstoneSource: (tx, ctx, _sourceId, ids) => forgetPracticeSources(tx, ctx, ids),
        cleanupSession: async (db, ctx, sessionId, now) => {
          await cleanupSessionProcessing(db, ctx, sessionId, { store: storage(), now });
          await forgetPracticeSources(db, ctx, [sessionId]);
        },
        cleanupAccount: (db, ctx, now) =>
          cleanupAccountProcessing(db, ctx, { store: storage(), now }),
        cleanupSource: async (db, ctx, sourceId, ids, now) => {
          await cleanupSourceProcessing(db, ctx, sourceId, { store: storage(), now });
          await forgetPracticeSources(db, ctx, ids);
        },
      },
      {
        // D49 learner corrections reference card goals; clean them before card purges.
        module: "pers",
        tombstoneSession: tombstoneSessionPers,
        tombstoneAccount: tombstoneAccountPers,
        cleanupSession: cleanupSessionPers,
        cleanupAccount: cleanupAccountPers,
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
