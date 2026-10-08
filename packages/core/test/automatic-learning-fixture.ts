import { randomUUID } from "node:crypto";
import type { Database } from "../src/db";
import { type EvidenceSource, type KnowledgeModel, publishKnowledgeVersion } from "../src/lkm";
import type { LearnerContext } from "../src/plt";
import { submitReview } from "../src/srs";

export async function publishAutomaticFixtureVersion(
  db: Database,
  ctx: LearnerContext,
  sessionId: string,
  model: KnowledgeModel,
  sources: readonly EvidenceSource[] = [],
) {
  return db.transaction().execute((tx) =>
    publishKnowledgeVersion(tx, ctx, {
      sessionId,
      runId: randomUUID(),
      sourcesVersion: 0,
      sourceFingerprint: randomUUID(),
      model,
      sources,
      explanationLanguage: "en",
      generation: { provider: "synthetic-automatic-learning", mode: "mock" },
    }),
  );
}

/** Keep cross-module orchestration outside the card dependency boundary. */
export async function reviewAutomaticFixtureCard(
  db: Database,
  ctx: LearnerContext,
  cardId: string,
  contentVersion: number,
  now: Date,
) {
  return submitReview(
    db,
    ctx,
    {
      eventId: randomUUID(),
      cardId,
      expectedVersion: 0,
      expectedContentVersion: contentVersion,
      mode: "simple",
      choice: "remembered",
    },
    now,
  );
}
