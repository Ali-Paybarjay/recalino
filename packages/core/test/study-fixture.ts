import { randomUUID } from "node:crypto";
import {
  acceptDocuments,
  CURRENT_VERSIONS,
  completeSignIn,
  createSignupIntent,
  updateProfile,
} from "../src/acc";
import { generateCards } from "../src/card";
import type { Database } from "../src/db";
import { type KnowledgeModel, publishKnowledgeVersion } from "../src/lkm";
import { publishNotebook } from "../src/note";
import { createSession } from "../src/org";
import { createAuthUser } from "./auth-users";

/** Synthetic test output only; no network AI requests or pilot allowances. */
export function syntheticKnowledge(count = 3): KnowledgeModel {
  const claim = (id: string, text: string, uncertain = false) => ({
    id,
    text,
    origin: "ai_expansion" as const,
    creation: "ai_generation" as const,
    evidence: "ai" as const,
    sourceRefs: [],
    speakerRole: "unknown" as const,
    uncertain,
  });
  return {
    schemaVersion: "1",
    title: "Synthetic study fixture",
    language: { learning: "en", explanation: "en" },
    summary: [claim("summary", "A synthetic explanation.")],
    topics: [],
    learningItems: Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      kind: "vocabulary" as const,
      front: `Synthetic question ${i}`,
      back: `Synthetic answer ${i}`,
      claim: claim(`claim-${i}`, `Synthetic item ${i}`),
    })),
    homework: [],
    uncertainties: [],
    coverage: { complete: true, missingSourceIds: [] },
  };
}
export async function studyFixture(
  db: Database,
  options: { count?: number; autoAdd?: boolean; now?: Date } = {},
) {
  const userId = await createAuthUser();
  const ctx = { userId, requestId: randomUUID() };
  const now = options.now ?? new Date();
  const intent = await createSignupIntent(db, { versions: CURRENT_VERSIONS, ttlSeconds: 60, now });
  await completeSignIn(db, { userId, intentId: intent.id, now });
  for (const change of [
    { field: "first_language", firstLanguage: "fa" },
    { field: "explanation_language", explanationLanguage: "english" },
    { field: "level_goal", level: null, goal: null },
    { field: "timezone", timezone: "Europe/London" },
  ] as const)
    await updateProfile(db, ctx, change, { now });
  await acceptDocuments(
    db,
    ctx,
    [{ document: "recording-consent", version: CURRENT_VERSIONS["recording-consent"] }],
    { now },
  );
  const session = await createSession(db, ctx, {}, { key: randomUUID(), now });
  const model = syntheticKnowledge(options.count);
  const knowledge = await db.transaction().execute((tx) =>
    publishKnowledgeVersion(
      tx,
      ctx,
      {
        sessionId: session.id,
        runId: randomUUID(),
        sourcesVersion: 0,
        sourceFingerprint: "fixture",
        model,
        sources: [],
        explanationLanguage: "en",
        generation: { provider: "synthetic-fixture", mode: "mock" },
      },
      now,
    ),
  );
  const notebook = await publishNotebook(
    db,
    ctx,
    session.id,
    { expectedRevisionId: null },
    { key: randomUUID(), now },
  );
  const generated = await generateCards(
    db,
    ctx,
    session.id,
    { autoAdd: options.autoAdd ?? false },
    { key: randomUUID(), now },
  );
  return { ctx, session, knowledge, notebook, cards: generated.cards, model, now };
}
