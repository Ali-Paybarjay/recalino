import { createHash, randomUUID } from "node:crypto";
import { acceptDocuments, CURRENT_VERSIONS, updateProfile } from "@recalino/core/acc";
import { createDatabase } from "@recalino/core/db";
import { createSession } from "@recalino/core/org";
import { amounts, grantEntitlement } from "@recalino/core/quota";
import {
  acceptSourceNotice,
  createSource,
  getSource,
  sourceNoticeAccepted,
} from "@recalino/core/src";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../../../../../packages/core/test/local-db";
import { defineRoute, type Handler } from "../api";
import { ROUTES, type RouteMeta } from "../routes";
import {
  classSourceHandler,
  classSourcesHandler,
  sourceAudioHandler,
  sourceCompleteHandler,
  sourceContentHandler,
  sourceContractHandler,
  sourceHandler,
  sourceNoticeHandler,
  sourcePartHandler,
  sourceReadHandler,
  sourcesHandler,
  sourceUnlockHandler,
  sourceUploadHandler,
} from "../source-routes";
import { routeDeps } from "../test-support";
import { newLearner, requestAs } from "./learners";

export function sourceCrossAccount(name: string) {
  const db = createDatabase(testDatabaseUrl(), { maxConnections: 2 });
  afterAll(() => db.destroy());
  const meta = (ROUTES as Record<string, RouteMeta>)[name];
  if (!meta) throw new Error(`missing route ${name}`);
  async function fixture() {
    const alice = await newLearner(db),
      bob = await newLearner(db),
      ctx = { userId: alice, requestId: randomUUID() },
      now = new Date();
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
    const session = await createSession(db, ctx, {}, { key: randomUUID() });
    await grantEntitlement(db, {
      userId: alice,
      startsAt: new Date(now.getTime() - 1000),
      endsAt: new Date(now.getTime() + 3600000),
      amounts: amounts({ storage: 10000 }),
      operationKey: randomUUID(),
      actorId: "test-operator",
      reason: "Synthetic source API verification",
    });
    await acceptSourceNotice(db, ctx, "0.1", true);
    const bytes = new TextEncoder().encode("Synthetic source fixture"),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const source = await createSource(db, ctx, {
      sessionId: session.id,
      kind: "text",
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      sha256,
      displayName: "Synthetic.txt",
      parts: [{ index: 0, sizeBytes: bytes.length, sha256 }],
      operationKey: randomUUID(),
    });
    return { alice, bob, ctx, session, source };
  }
  function handler(x: {
    session: { id: string };
    source: { assetId: string; uploadId: string | null };
  }): Handler {
    switch (name) {
      case "sourceContract":
        return sourceContractHandler();
      case "sourceNotice":
        return sourceNoticeHandler();
      case "sources":
        return sourcesHandler();
      case "source":
        return sourceHandler(x.source.assetId);
      case "sourceContent":
        return sourceContentHandler(x.source.assetId);
      case "sourceRead":
        return sourceReadHandler(x.source.assetId);
      case "classSources":
        return classSourcesHandler(x.session.id);
      case "classSource":
        return classSourceHandler(x.session.id, x.source.assetId);
      case "sourceUpload":
        return sourceUploadHandler(x.source.uploadId as string);
      case "sourcePart":
        return sourcePartHandler(x.source.uploadId as string, "0");
      case "sourceComplete":
        return sourceCompleteHandler(x.source.uploadId as string);
      case "sourceAudio":
        return sourceAudioHandler(x.source.assetId);
      case "sourceUnlock":
        return sourceUnlockHandler(x.source.assetId);
      default:
        throw new Error("unknown source route");
    }
  }
  describe(`${name} account isolation (FR-PLT-002,FR-SRC-001,012,015)`, () => {
    it("requires authentication and hides another learner's source state", async () => {
      const x = await fixture(),
        route = defineRoute(meta, handler(x), routeDeps(db));
      const method =
        name === "sourceNotice" || name === "sourceComplete" || name === "sourceUnlock"
          ? "POST"
          : name === "classSource"
            ? "DELETE"
            : "GET";
      const body = name === "sourceNotice" ? { version: "0.1", confirmed: true } : undefined;
      expect((await route(requestAs(null, meta.path, method, body))).status).toBe(401);
      const response = await route(requestAs(x.bob, meta.path, method, body));
      if (name === "sourceContract") {
        expect(response.status).toBe(200);
        expect((await response.json()).noticeAccepted).toBe(false);
      } else if (name === "sources") {
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
      } else if (name === "sourceNotice") {
        expect(response.status).toBe(200);
        expect(await sourceNoticeAccepted(db, { userId: x.bob, requestId: "test" }, "0.1")).toBe(
          true,
        );
        expect(await sourceNoticeAccepted(db, x.ctx, "0.1")).toBe(true);
      } else expect(response.status).toBe(404);
      if (name === "sourcePart") {
        expect((await route(requestAs(null, meta.path, "POST"))).status).toBe(401);
        expect((await route(requestAs(x.bob, meta.path, "POST"))).status).toBe(404);
      }
      expect((await getSource(db, x.ctx, x.source.assetId)).display_name).toBe("Synthetic.txt");
    });
  });
}
