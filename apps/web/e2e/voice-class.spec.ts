import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { ClassVoiceView, VoiceAnalysisView } from "@recalino/core/voice-contracts";
import { keepOriginalsOnDevice } from "./voice-originals";

// D65: every changed screen at 390 px and 1440 px, for the owner's one review at the end.
const output = resolve(import.meta.dirname, "../../../artifacts/verification/feat-voice-detection");
const learnerId = "10000000-0000-4000-8000-000000000002";

function part(source: number): VoiceAnalysisView {
  const id = `10000000-0000-4000-8000-00000000000${source + 2}`;
  const voice = (speaker: string, cleanSpeechMs: number, text: string) => ({
    id: `${speaker}-${source}`,
    label: `Voice ${speaker}`,
    score: null,
    cleanSpeechMs,
    clips: cleanSpeechMs
      ? [0, 1].map((index) => ({
          startMs: index * 12000,
          endMs: index * 12000 + 8000,
          text: `Part ${source}: ${text}`,
        }))
      : [],
    lines: [text],
  });
  return {
    id,
    sourceId: `20000000-0000-4000-8000-00000000000${source}`,
    version: 1,
    status: "unverified",
    candidateId: `learner-${source}`,
    verifiedSpeakerId: null,
    verificationMethod: null,
    reason: null,
    source: {
      name: `Synthetic class part ${source}`,
      durationMs: 600000,
      sizeBytes: 100,
      sha256: "a".repeat(64),
      mimeType: "audio/wav",
    },
    candidates: [
      voice("learner", 24000, "I am practising English with my class."),
      voice("teacher", 90000, "Open your books at page ten."),
      // A fragment: too little clear speech to suggest; grouped as a short voice.
      { ...voice("fragment", 3000, "Yes."), clips: [{ startMs: 30000, endMs: 33000, text: "" }] },
    ],
    shortCandidateIds: [`fragment-${source}`],
    speakerLinks: {
      [`learner-${source}`]: { voiceId: "learner-1", ambiguous: false },
      [`teacher-${source}`]: { voiceId: "teacher-1", ambiguous: false },
    },
    lines:
      source === 1
        ? [
            {
              utteranceId: "short-1",
              speakerId: "teacher-1",
              startMs: 61000,
              endMs: 62800,
              text: "I goes to school by bus.",
              proposed: true,
              choice: null,
            },
          ]
        : [],
  };
}
function classView(): ClassVoiceView {
  const analyses = [part(1), part(2)];
  return {
    enabled: true,
    engineAvailable: true,
    features: { classConfirmation: true, lineChoices: true },
    classCandidateId: "learner-1",
    classVoices: [
      {
        id: "learner-1",
        label: "Voice 1",
        ambiguous: false,
        cleanSpeechMs: 48000,
        members: analyses.map((item, index) => ({
          analysisId: item.id,
          speakerId: `learner-${index + 1}`,
        })),
      },
      {
        id: "teacher-1",
        label: "Voice 2",
        ambiguous: false,
        cleanSpeechMs: 180000,
        members: analyses.map((item, index) => ({
          analysisId: item.id,
          speakerId: `teacher-${index + 1}`,
        })),
      },
    ],
    analyses,
  };
}

async function shoot(page: Page, name: string) {
  // A settled screen, not one caught between a choice and its refreshed notes.
  await expect(page.getByText("Refreshing your session notes…")).toHaveCount(0);
  await expect(
    page.getByText("Updating voice attribution before showing the session notes…"),
  ).toHaveCount(0);
  await mkdir(output, { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: resolve(output, `${name}-${width}.png`), fullPage: true });
  }
}

test("D64 one confirmation for the whole class, short voices grouped, lines marked one by one", async ({
  page,
}) => {
  const view = classView();
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/classes/*/voice", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push(body);
      if (body.scope === "class" && body.action === "confirm")
        for (const analysis of view.analyses) {
          analysis.version++;
          analysis.status = "verified";
          analysis.verificationMethod = "manual";
          analysis.verifiedSpeakerId = `learner-${analysis.sourceId.at(-1)}`;
        }
      if (body.scope === "line") {
        const analysis = view.analyses.find((item) => item.id === body.analysisId);
        const line = analysis?.lines?.find((item) => item.utteranceId === body.utteranceId);
        if (analysis && line) {
          analysis.version++;
          line.choice = body.choice === "clear" ? null : (body.choice as "mine" | "not_mine");
        }
      }
      view.classCandidateId = view.analyses.some((item) => item.status === "unverified")
        ? "learner-1"
        : null;
    }
    await route.fulfill({ json: view });
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/dev/ui/voice?view=class");
  const whole = page.getByRole("region", { name: "Your voice in this class" });
  await expect(whole).toBeVisible();
  // D55: a voice is confirmed by ear; nothing is offered until an excerpt can play here.
  await expect(whole.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Source 1 voice confirmation" })
      .getByText("The original audio isn't on this device."),
  ).toBeVisible();
  await keepOriginalsOnDevice(page, { 1: learnerId, 2: learnerId });
  await expect(whole.getByText("Heard in 2 of 2 recordings")).toBeVisible();
  // Each part defers to the class choice instead of asking again.
  const first = page.getByRole("region", { name: "Source 1 voice confirmation" });
  await expect(
    first.getByText("Your choice for the whole class above covers this recording."),
  ).toBeVisible();
  await expect(first.getByRole("button", { name: "Yes, this is my voice" })).toHaveCount(0);
  await expect(first.getByText("Lines that may be yours")).toBeVisible();
  await shoot(page, "voice-class-confirmation");

  await whole.getByRole("button", { name: "Yes, this is my voice" }).click();
  await expect(whole.getByText("Your voice is confirmed for this whole class.")).toBeVisible();
  expect(writes.at(-1)).toEqual({
    scope: "class",
    action: "confirm",
    classVoiceId: "learner-1",
    expected: view.analyses.map((item) => ({ analysisId: item.id, version: 1 })),
  });
  await first.getByRole("button", { name: "This is me" }).click();
  await expect(first.getByText(/Marked as yours/)).toBeVisible();
  expect(writes.at(-1)).toMatchObject({
    scope: "line",
    utteranceId: "short-1",
    choice: "mine",
  });
  await shoot(page, "voice-class-confirmed");
});

test("D64 kill switch: without class confirmation, short voices are grouped per part", async ({
  page,
}) => {
  const view = { ...classView(), features: { classConfirmation: false, lineChoices: false } };
  for (const analysis of view.analyses) delete analysis.lines;
  await page.route("**/api/classes/*/voice", (route) => route.fulfill({ json: view }));
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/dev/ui/voice?view=class");
  await expect(page.getByRole("region", { name: "Your voice in this class" })).toHaveCount(0);
  const first = page.getByRole("region", { name: "Source 1 voice confirmation" });
  // The page creates the device store once a part says its original is not here.
  await expect(first.getByText("The original audio isn't on this device.")).toBeVisible();
  await keepOriginalsOnDevice(page, { 1: learnerId, 2: learnerId });
  await first.getByRole("button", { name: "No, show other speakers" }).click();
  await expect(first.getByText("Short voices (1)")).toBeVisible();
  await first.getByText("Short voices (1)").click();
  await shoot(page, "voice-part-short-voices");
});
