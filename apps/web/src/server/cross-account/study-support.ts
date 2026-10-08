import { randomUUID } from "node:crypto";
import { createDatabase } from "@recalino/core/db";
import { getReviewSettings, submitReview } from "@recalino/core/srs";
import { afterAll, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { studyFixture } from "../../../../../packages/core/test/study-fixture";
import { defineRoute, type Handler } from "../api";
import { ROUTES } from "../routes";
import {
  cardActionsHandler,
  cardHandler,
  cardMediaHandler,
  cardProposalHandler,
  cardProposalsHandler,
  classCardsHandler,
  notebookHandler,
  noteRevisionHandler,
  noteVersionsHandler,
  reviewEventHandler,
  reviewQueueHandler,
  reviewSettingsHandler,
  reviewUndoHandler,
} from "../study-routes";
import { routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

type StudyRoute =
  | "noteNotebook"
  | "noteVersions"
  | "noteRevision"
  | "classCards"
  | "card"
  | "cardActions"
  | "cardProposals"
  | "cardProposal"
  | "cardMedia"
  | "reviewQueue"
  | "reviewEvent"
  | "reviewUndo"
  | "reviewSettings";
export function verifyStudyRoute(id: StudyRoute) {
  const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
  afterAll(() => db.destroy());
  it("requires a learner session", async () => {
    const response = await defineRoute(
      ROUTES[id],
      reviewQueueHandler(),
      routeDeps(db),
    )(requestAs(null, ROUTES[id].path, "GET"));
    expect(response.status).toBe(401);
  });
  it("keeps study content private to its owner", async () => {
    const fixture = await studyFixture(db, { autoAdd: true });
    const other = await newLearner(db);
    const card = fixture.cards[0];
    if (!card) throw new Error("missing card");
    let handler: Handler,
      method = "GET",
      body: unknown,
      path = ROUTES[id].path.replace("[id]", card.id);
    switch (id) {
      case "noteNotebook":
        handler = notebookHandler(fixture.session.id);
        method = "POST";
        body = { expectedRevisionId: null };
        break;
      case "noteVersions":
        handler = noteVersionsHandler(fixture.session.id);
        break;
      case "noteRevision":
        handler = noteRevisionHandler(fixture.notebook.current.id);
        break;
      case "classCards":
        handler = classCardsHandler(fixture.session.id);
        method = "POST";
        body = {};
        break;
      case "card":
        handler = cardHandler(card.id);
        method = "PATCH";
        body = { expectedVersion: 1, front: "Stolen", back: "Answer", newLearningGoal: false };
        break;
      case "cardActions":
        handler = cardActionsHandler(card.id);
        method = "POST";
        body = { expectedVersion: 1, action: "know" };
        break;
      case "cardProposals":
        handler = cardProposalsHandler(card.id);
        break;
      case "cardProposal":
        handler = cardProposalHandler(card.id, randomUUID());
        method = "POST";
        body = { expectedVersion: 1, action: "dismiss", newLearningGoal: false };
        break;
      case "cardMedia":
        handler = cardMediaHandler(card.id);
        method = "POST";
        body = { expectedVersion: 1, side: "front", mediaId: null };
        break;
      case "reviewQueue":
        handler = reviewQueueHandler();
        path += `?sessionId=${fixture.session.id}`;
        break;
      case "reviewEvent":
        handler = reviewEventHandler();
        method = "POST";
        body = {
          eventId: randomUUID(),
          cardId: card.id,
          expectedVersion: 0,
          expectedContentVersion: 1,
          mode: "simple",
          choice: "remembered",
        };
        break;
      case "reviewUndo": {
        const receipt = await submitReview(db, fixture.ctx, {
          eventId: randomUUID(),
          cardId: card.id,
          expectedVersion: 0,
          expectedContentVersion: 1,
          mode: "simple",
          choice: "remembered",
        });
        handler = reviewUndoHandler(receipt.eventId);
        method = "POST";
        body = { expectedVersion: receipt.version };
        break;
      }
      case "reviewSettings": {
        handler = reviewSettingsHandler();
        method = "PATCH";
        body = { mode: "advanced", desiredRetention: 0.9, dailyNewLimit: 4, timeBudgetMinutes: 20 };
        const request = requestAs(other, path, method, body);
        const response = await defineRoute(ROUTES[id], handler, routeDeps(db))(request);
        expect(response.status).toBe(200);
        expect((await getReviewSettings(db, fixture.ctx)).mode).toBe("simple");
        return;
      }
    }
    const request = requestAs(other, path, method, body);
    request.headers.set("idempotency-key", randomUUID());
    const response = await defineRoute(
      {
        ...ROUTES[id],
        ...(method !== "GET" && !id.startsWith("review")
          ? { idempotency: "handler" as const }
          : {}),
      },
      handler,
      routeDeps(db),
    )(request);
    expect(response.status).toBe(404);
  }, 30000);
}
