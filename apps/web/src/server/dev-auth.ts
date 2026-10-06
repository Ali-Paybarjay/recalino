import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "@recalino/core/acc";
import { synchronizeAutomaticCards } from "@recalino/core/card";
import { publishKnowledgeVersion } from "@recalino/core/lkm";
import { automaticPublishNotebook } from "@recalino/core/note";
import { createSession } from "@recalino/core/org";
import { errors } from "@recalino/core/plt";
import { requestAutomaticLearning, updateAutomaticLearningProgress } from "@recalino/core/proc";
import { z } from "zod";
import type { Handler } from "./api";
import { createAuthAdmin, createAuthClient } from "./auth/supabase";
import { testSignInAvailable } from "./local-test-policy";

export { testSignInAvailable } from "./local-test-policy";

/**
 * Test sign-in for the end-to-end tests, which can't reach Google. It exists only when the dev
 * pages are on and Auth runs on this machine; against any other Auth server it is a 404, so it
 * can never mint a session on the cloud project.
 */
const sessionSchema = z.object({
  setup: z.enum(["none", "complete"]).default("none"),
  firstLanguage: z.string().default("fa"),
  studyFixture: z.boolean().default(false),
  automaticStudyFixture: z.boolean().default(false),
  /** Pretend the learner accepted older texts, to test asking again (FR-ACC-007, D33). */
  acceptedVersions: z
    .object({ terms: z.string(), privacy: z.string(), "recording-consent": z.string() })
    .partial()
    .default({}),
});

/** POST /dev/auth/session: a fresh learner, signed in through a password only local Auth has. */
export function devSessionHandler(): Handler {
  return async ({ input, db }) => {
    if (!testSignInAvailable(process.env)) throw errors.notFound();
    const options = sessionSchema.parse(input ?? {});
    const versions = { ...CURRENT_VERSIONS, ...options.acceptedVersions };

    const email = `learner-${randomUUID()}@example.test`;
    const password = randomBytes(24).toString("base64url");
    const created = await createAuthAdmin().createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Test user could not be created");
    const userId = created.data.user.id;

    const now = new Date();
    const intent = await createSignupIntent(db, { versions, ttlSeconds: 60, now });
    await completeSignIn(db, { userId, intentId: intent.id, now });

    if (options.setup === "complete") {
      const ctx = { userId, requestId: randomUUID() };
      for (const change of [
        { field: "first_language", firstLanguage: options.firstLanguage },
        { field: "explanation_language", explanationLanguage: "english" },
        { field: "level_goal", level: null, goal: null },
        { field: "timezone", timezone: "Europe/London" },
      ] as const) {
        await updateProfile(db, ctx, change, { now });
      }
      await acceptDocuments(
        db,
        ctx,
        [{ document: "recording-consent", version: versions["recording-consent"] }],
        { now, versions },
      );
    }

    let sessionId: string | undefined;
    if (options.studyFixture && options.setup === "complete") {
      const ctx = { userId, requestId: randomUUID() };
      const session = await createSession(
        db,
        ctx,
        { title: "Local synthetic class" },
        { key: randomUUID(), now },
      );
      sessionId = session.id;
      const claim = (id: string, text: string) => ({
        id,
        text,
        origin: "ai_expansion",
        creation: "ai_generation",
        evidence: "ai",
        sourceRefs: [],
        speakerRole: "unknown",
        uncertain: false,
      });
      const knowledge = await db.transaction().execute((tx) =>
        publishKnowledgeVersion(
          tx,
          ctx,
          {
            sessionId: session.id,
            runId: randomUUID(),
            sourcesVersion: 0,
            sourceFingerprint: "local-synthetic-fixture",
            sources: [],
            explanationLanguage: "en",
            generation: { provider: "synthetic-local-fixture", mode: "mock" },
            model: {
              schemaVersion: "1",
              title: "Synthetic notes for local testing",
              summary: [claim("summary", "This is local synthetic test content.")],
              topics: [
                {
                  id: "travel-questions",
                  title: "Travel questions",
                  claims: [claim("travel-questions-claim", "Ask where a train leaves from.")],
                },
                {
                  id: "present-simple",
                  title: "Present simple",
                  claims: [claim("present-simple-claim", "Use the present simple for timetables.")],
                },
                {
                  id: "station-vocabulary",
                  title: "Station vocabulary",
                  claims: [claim("station-vocabulary-claim", "A platform is where a train stops.")],
                },
                {
                  id: "polite-requests",
                  title: "Polite requests",
                  claims: [claim("polite-requests-claim", "Ask for help with a polite question.")],
                },
              ],
              learningItems: [
                {
                  id: "word",
                  kind: "vocabulary",
                  front: "A journey by train",
                  back: "A rail trip",
                  claim: claim("word-claim", "A synthetic learning item."),
                },
              ],
              homework: [],
              uncertainties: [],
              language: { learning: "en", explanation: "en" },
              coverage: { complete: true, missingSourceIds: [] },
            },
          },
          now,
        ),
      );
      if (options.automaticStudyFixture) {
        const notebook = await automaticPublishNotebook(db, ctx, session.id, knowledge.id, {
          key: `synthetic-automatic-notes:${knowledge.id}`,
          now,
        });
        await synchronizeAutomaticCards(db, ctx, session.id, {
          key: `synthetic-automatic-cards:${notebook.current.id}`,
          now,
        });
        const automatic = await requestAutomaticLearning(db, ctx, session.id, {
          changed: false,
          now,
        });
        await updateAutomaticLearningProgress(
          db,
          ctx,
          session.id,
          automatic.requestVersion,
          { state: "ready", lastError: null },
          now,
        );
      }
    }
    const signIn = await (await createAuthClient()).auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error("Test sign-in failed");
    return { body: { userId, sessionId } };
  };
}
