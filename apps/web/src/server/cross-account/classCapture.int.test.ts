import { randomUUID } from "node:crypto";
import { captureInProgress } from "@recalino/core/org";
import { getAutomaticLearningSession } from "@recalino/core/proc";
import { expect, it, vi } from "vitest";
import { classCaptureHandler } from "../capture-staging";
import { ROUTES } from "../routes";
import { orgCall, orgFixture, orgTestDatabase, unauthenticatedOrg } from "./org-support";

const jobs = vi.hoisted(() => vi.fn());
vi.mock("../jobs", () => ({
  runJobsSoon: jobs,
  PROCESSING_WAKE: { budgetSeconds: 60, functionSeconds: 120 },
}));

const db = orgTestDatabase();
unauthenticatedOrg(db, ROUTES.classCapture, classCaptureHandler(randomUUID()), "POST");
it("opens and closes a capture lease only on the learner's own class (D60)", async () => {
  const owner = await orgFixture(db),
    attacker = await orgFixture(db);
  const call = (userId: string, action: "open" | "close") =>
    orgCall(
      db,
      ROUTES.classCapture,
      classCaptureHandler(owner.session.id),
      userId,
      `/api/classes/${owner.session.id}/capture`,
      "POST",
      { action },
      randomUUID(),
    );
  expect((await call(attacker.owner, "open")).status).toBe(404);
  expect(await captureInProgress(db, owner.actor, owner.session.id)).toBe(false);
  const opened = await call(owner.owner, "open");
  expect(opened.status).toBe(200);
  expect(await opened.json()).toMatchObject({ earlyUpload: true, earlyTranscription: true });
  expect(await captureInProgress(db, owner.actor, owner.session.id)).toBe(true);
  expect((await call(attacker.owner, "close")).status).toBe(404);
  expect(await captureInProgress(db, owner.actor, owner.session.id)).toBe(true);
  // Kill switch: no lease is opened and the app is told both behaviours are off.
  process.env.RECALINO_CAPTURE_EARLY_UPLOAD = "off";
  try {
    const off = await call(owner.owner, "open");
    expect(await off.json()).toEqual({
      earlyUpload: false,
      earlyTranscription: false,
      openUntil: null,
    });
  } finally {
    delete process.env.RECALINO_CAPTURE_EARLY_UPLOAD;
  }
  jobs.mockClear();
  expect((await call(owner.owner, "close")).status).toBe(200);
  // D105: Stop ends one recording, not the session. Only early transcription (D61) is woken;
  // lesson work waits for the learner's Process this session.
  expect(jobs).toHaveBeenCalledExactlyOnceWith(["proc.capture_transcription"], 60, 120);
  expect(await captureInProgress(db, owner.actor, owner.session.id)).toBe(false);
  expect(await getAutomaticLearningSession(db, owner.actor, owner.session.id)).toBeNull();
});
