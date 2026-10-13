import { randomUUID } from "node:crypto";
import { renewCaptureLease } from "@recalino/core/org";
import { sha256Hex } from "@recalino/core/plt";
import { beginStagedAudioUpload, createRecordedSource } from "@recalino/core/src";
import { expect, it } from "vitest";
import { stagedAudioHandler } from "../capture-staging";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.sourceStagedAudio, stagedAudioHandler(randomUUID()), "POST");
it("refuses staging, reading or completing another learner's recorded part (D60)", async () => {
  const owner = await orgFixture(db),
    attacker = await orgFixture(db);
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]);
  const part = await createRecordedSource(db, owner.actor, {
    sessionId: owner.session.id,
    kind: "audio",
    mimeType: "audio/webm",
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    displayName: "Session recording · Part 1",
    durationMs: 6000,
    parts: [],
    operationKey: `recorded-source:${randomUUID()}`,
  });
  const path = `/api/sources/${part.assetId}/audio/staged`;
  const parts = [{ index: 0, sizeBytes: bytes.length, sha256: sha256Hex(bytes) }];
  const handler = stagedAudioHandler(part.assetId);
  const refused = await orgCall(
    db,
    ROUTES.sourceStagedAudio,
    handler,
    attacker.owner,
    path,
    "POST",
    { action: "start", parts },
    randomUUID(),
  );
  expect(refused.status).toBe(404);
  // Kill switch: the server refuses staging whatever the client sends.
  process.env.RECALINO_CAPTURE_EARLY_UPLOAD = "off";
  try {
    const off = await orgCall(
      db,
      ROUTES.sourceStagedAudio,
      handler,
      owner.owner,
      path,
      "POST",
      { action: "start", parts },
      randomUUID(),
    );
    expect(off.status).toBe(400);
    expect(await off.json()).toMatchObject({
      error: { details: { fields: { audio: ["early_upload_disabled"] } } },
    });
  } finally {
    delete process.env.RECALINO_CAPTURE_EARLY_UPLOAD;
  }
  // Local tests have no object store; the core call stages the owner's copy directly.
  await renewCaptureLease(db, owner.actor, owner.session.id);
  const { uploadId } = await beginStagedAudioUpload(db, owner.actor, part.assetId, { parts });
  for (const [method, body] of [
    ["GET", undefined],
    ["POST", { action: "complete", uploadId }],
  ] as const) {
    const response = await orgCall(
      db,
      ROUTES.sourceStagedAudio,
      handler,
      attacker.owner,
      method === "GET" ? `${path}?uploadId=${uploadId}` : path,
      method,
      body,
      randomUUID(),
    );
    expect(response.status).toBe(404);
  }
});
