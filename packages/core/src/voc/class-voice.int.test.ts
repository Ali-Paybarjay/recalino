import { randomUUID } from "node:crypto";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../../test/local-db";
import { referenceStudyModel } from "../../test/reference-study-fixture";
import { voiceFixture } from "../../test/voice-fixture";
import { createDatabase } from "../db";
import { renderClassNotesHtml } from "../lkm";
import { MemoryObjectStore } from "../plt";
import {
  changeClassVoiceIdentity,
  changeVoiceIdentity,
  changeVoiceLine,
  getClassVoice,
  saveVoiceAnalysis,
  saveVoiceCandidateMistakes,
} from "./analysis";
import type { VoiceAnalysisInput, VoiceCandidate } from "./contracts";
import { expireVoiceEmbeddings } from "./privacy";
import { getVoiceEnrollment, revokeVoiceData, saveVoiceSample } from "./profile";
import { projectVerifiedSpeech } from "./projection";

const db = createDatabase(testDatabaseUrl(), { maxConnections: 4 });
afterAll(() => db.destroy());
afterEach(() => vi.unstubAllEnvs());

type Fixture = Awaited<ReturnType<typeof voiceFixture>>;
/** A 16-dimensional unit vector mostly along `axis`, tilted slightly toward `tilt`. */
const vector = (axis: number, tilt = 0) =>
  Array.from({ length: 16 }, (_, index) => (index === axis ? 1 : index === 15 ? tilt : 0));
const voice = (id: string, cleanSpeechMs: number, clip = true): VoiceCandidate => ({
  id,
  label: `Voice ${id}`,
  score: null,
  cleanSpeechMs,
  clips: clip ? [{ startMs: 1000, endMs: 8000, text: "" }] : [],
  lines: [],
});

/** Another recording part of the same class, as an in-app recording's next part arrives. */
async function addPart(
  x: Fixture,
  part: Pick<VoiceAnalysisInput, "candidates" | "embeddings"> &
    Partial<Pick<VoiceAnalysisInput, "utterances" | "turnEmbeddings">>,
) {
  const source = await db
    .insertInto("src.asset")
    .values({
      user_id: x.ctx.userId,
      kind: "audio",
      declared_mime: "audio/wav",
      size_bytes: 100,
      sha256: "c".repeat(64),
      display_name: "Synthetic classroom part",
      contract_version: x.source.contract_version,
      retention: "device_only",
      duration_ms: 90000,
      operation_key: randomUUID(),
      request_hash: "fixture",
      verified_at: x.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const version = await db
    .insertInto("src.content_version")
    .values({
      asset_id: source.id,
      user_id: x.ctx.userId,
      origin_key: randomUUID(),
      sha256: "d".repeat(64),
      schema_version: "1",
      provenance: "machine_extraction",
      extraction_settings: "{}",
      units: "[]",
      blocks: "[]",
      request_hash: "fixture",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .insertInto("src.session_source")
    .values({
      user_id: x.ctx.userId,
      session_id: x.session.id,
      asset_id: source.id,
      role: "class_audio",
      selected: true,
      time_status: "exact",
      selected_content_version_id: version.id,
    })
    .execute();
  return saveVoiceAnalysis(db, x.ctx, {
    sessionId: x.session.id,
    sourceId: source.id,
    sourceVersionId: version.id,
    runId: x.input.runId,
    profileVersion: x.input.profileVersion,
    modelVersion: x.input.modelVersion,
    utterances: [],
    ...part,
  });
}

it("FR-VOC-004 workstream 4: a fragment without a voiceprint or excerpt is never suggested", async () => {
  const x = await voiceFixture(db);
  // The 2026-10-12 shape: a 0 s voice whose hash id sorts first, and one clear voice.
  const part = await addPart(x, {
    candidates: [voice("aaa-fragment", 0, false), voice("zzz-clear", 42500)],
    embeddings: [{ speakerId: "zzz-clear", vector: vector(3) }],
  });
  expect(part.candidateId).toBe("zzz-clear");
  const view = (await getClassVoice(db, x.ctx, x.session.id)).analyses.find(
    (item) => item.id === part.id,
  );
  expect(view?.shortCandidateIds).toEqual(["aaa-fragment"]);
  vi.stubEnv("VOICE_SETTINGS_JSON", '{"classConfirmation":false}');
  const rejected = await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "reject",
    analysisId: part.id,
    expectedVersion: view?.version ?? 0,
    speakerId: "zzz-clear",
  });
  // The fragment stays choosable from its group but does not become the suggestion.
  expect(rejected.status).toBe("unverified");
  expect(rejected.candidateId).toBeNull();
});

it("PRD-SPK-02 links parts as they arrive and asks once for the whole class", async () => {
  const x = await voiceFixture(db);
  // Part 2: the same learner (axis 0) and a teacher heard only here (axis 2).
  const second = await addPart(x, {
    candidates: [voice("p2-learner", 30000), voice("p2-teacher", 90000)],
    embeddings: [
      { speakerId: "p2-learner", vector: vector(0, 0.1) },
      { speakerId: "p2-teacher", vector: vector(2) },
    ],
  });
  let view = await getClassVoice(db, x.ctx, x.session.id);
  const learnerVoice = view.classVoices?.find((item) =>
    item.members.some((member) => member.speakerId === "p2-learner"),
  );
  expect(learnerVoice?.members).toEqual(
    expect.arrayContaining([
      { analysisId: x.analysis.id, speakerId: "learner" },
      { analysisId: second.id, speakerId: "p2-learner" },
    ]),
  );
  expect(learnerVoice?.ambiguous).toBe(false);
  expect(view.features).toEqual({ classConfirmation: true, lineChoices: true });
  expect(view.classCandidateId).not.toBeNull();
  // A stale view of the class cannot decide it.
  await expect(
    changeClassVoiceIdentity(db, x.ctx, x.session.id, {
      scope: "class",
      action: "confirm",
      classVoiceId: learnerVoice?.id ?? "",
      expected: view.analyses.map((item) => ({ analysisId: item.id, version: item.version + 1 })),
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  await changeClassVoiceIdentity(db, x.ctx, x.session.id, {
    scope: "class",
    action: "confirm",
    classVoiceId: learnerVoice?.id ?? "",
    expected: view.analyses.map((item) => ({ analysisId: item.id, version: item.version })),
  });
  view = await getClassVoice(db, x.ctx, x.session.id);
  expect(
    Object.fromEntries(view.analyses.map((item) => [item.id, item.verifiedSpeakerId])),
  ).toEqual({ [x.analysis.id]: "learner", [second.id]: "p2-learner" });
  // One class adds at most one reference: the part with the most clean speech.
  const references = (await getVoiceEnrollment(db, x.ctx)).embeddings;
  expect(references.map((entry) => entry.analysisId)).toEqual([second.id]);
  // Spoken mistakes of the confirmed voice appear once for the class.
  expect(
    renderClassNotesHtml(
      await projectVerifiedSpeech(db, x.ctx, x.session.id, referenceStudyModel()),
    ),
  ).toContain("I went home.");

  // Part 3 arrives after the confirmation: its learner joins the same class voice through the
  // confirmed part's reference, and stays a question (automatic acceptance stays off, D54).
  const third = await addPart(x, {
    candidates: [voice("p3-learner", 25000)],
    embeddings: [{ speakerId: "p3-learner", vector: vector(0, 0.05) }],
  });
  view = await getClassVoice(db, x.ctx, x.session.id);
  const joined = view.classVoices?.find((item) => item.id === learnerVoice?.id);
  expect(joined?.members).toEqual(
    expect.arrayContaining([{ analysisId: third.id, speakerId: "p3-learner" }]),
  );
  expect(view.analyses.find((item) => item.id === third.id)?.status).toBe("unverified");
  expect(view.classCandidateId).toBe(learnerVoice?.id);
});

it("FR-VOC-002 two voices of one part both like a voice elsewhere stay unlinked and ambiguous", async () => {
  const x = await voiceFixture(db);
  await addPart(x, {
    candidates: [voice("twin-a", 30000), voice("twin-b", 30000)],
    embeddings: [
      { speakerId: "twin-a", vector: vector(0, 0.1) },
      { speakerId: "twin-b", vector: vector(0, -0.1) },
    ],
  });
  const view = await getClassVoice(db, x.ctx, x.session.id);
  const learner = view.classVoices?.find((item) =>
    item.members.some((member) => member.speakerId === "learner"),
  );
  expect(learner?.members).toHaveLength(1);
  expect(learner?.ambiguous).toBe(true);
});

it("D64 kill switch: with class confirmation off, a class choice is refused", async () => {
  const x = await voiceFixture(db);
  vi.stubEnv("VOICE_SETTINGS_JSON", '{"classConfirmation":false}');
  await expect(
    changeClassVoiceIdentity(db, x.ctx, x.session.id, {
      scope: "class",
      action: "none",
      expected: [{ analysisId: x.analysis.id, version: 1 }],
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
  expect((await getClassVoice(db, x.ctx, x.session.id)).features?.classConfirmation).toBe(false);
});

it("D64: a learner's short turn is proposed from its own score, and a line marked as theirs shows its checked mistake", async () => {
  const x = await voiceFixture(db),
    model = referenceStudyModel();
  await saveVoiceSample(db, new MemoryObjectStore(), x.ctx, {
    profileVersion: x.input.profileVersion,
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "audio/wav",
    durationMs: 30000,
    modelVersion: x.input.modelVersion,
    embedding: vector(5),
  });
  const shortTurns = [
    {
      id: "t1",
      speakerId: "teacher",
      startMs: 1000,
      endMs: 3000,
      text: "I goes there.",
      eligible: true,
    },
    {
      id: "t2",
      speakerId: "teacher",
      startMs: 20000,
      endMs: 22000,
      text: "I goes there.",
      eligible: true,
    },
    {
      id: "t3",
      speakerId: "teacher",
      startMs: 30000,
      endMs: 36000,
      text: "Open your books.",
      eligible: true,
    },
  ];
  const part = await addPart(x, {
    candidates: [voice("teacher", 60000)],
    embeddings: [{ speakerId: "teacher", vector: vector(2) }],
    utterances: shortTurns,
    turnEmbeddings: [
      { utteranceId: "t1", vector: vector(5, 0.1) },
      { utteranceId: "t2", vector: vector(5, 0.2) },
      { utteranceId: "t3", vector: vector(2) },
    ],
  });
  await saveVoiceCandidateMistakes(db, x.ctx, {
    analysisId: part.id,
    profileVersion: x.input.profileVersion,
    mistakes: {
      teacher: [
        {
          utteranceId: "t1",
          said: "I **goes** there.",
          correct: "I go there.",
          whyFa: "با I فعل بدون s می‌آید.",
          kind: "grammar",
          teacherCorrected: false,
        },
      ],
    },
  });
  let view = (await getClassVoice(db, x.ctx, x.session.id)).analyses.find(
    (item) => item.id === part.id,
  );
  expect(view?.lines?.filter((line) => line.proposed).map((line) => line.utteranceId)).toEqual([
    "t1",
    "t2",
  ]);
  expect(
    renderClassNotesHtml(await projectVerifiedSpeech(db, x.ctx, x.session.id, model)),
  ).not.toContain("I go there.");
  const marked = await changeVoiceLine(db, x.ctx, x.session.id, {
    scope: "line",
    analysisId: part.id,
    expectedVersion: view?.version ?? 0,
    utteranceId: "t1",
    choice: "mine",
  });
  expect(marked.lines?.find((line) => line.utteranceId === "t1")?.choice).toBe("mine");
  expect(
    renderClassNotesHtml(await projectVerifiedSpeech(db, x.ctx, x.session.id, model)),
  ).toContain("I go there.");
  // Rejecting the whole voice keeps the line the learner marked as theirs.
  vi.stubEnv("VOICE_SETTINGS_JSON", '{"classConfirmation":false}');
  view = (await getClassVoice(db, x.ctx, x.session.id)).analyses.find(
    (item) => item.id === part.id,
  );
  await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "none",
    analysisId: part.id,
    expectedVersion: view?.version ?? 0,
  });
  expect(
    renderClassNotesHtml(await projectVerifiedSpeech(db, x.ctx, x.session.id, model)),
  ).toContain("I go there.");
  // Kill switch: line choices no longer count, and no line can be marked.
  vi.stubEnv("VOICE_SETTINGS_JSON", '{"targetTurns":false}');
  expect(
    renderClassNotesHtml(await projectVerifiedSpeech(db, x.ctx, x.session.id, model)),
  ).not.toContain("I go there.");
  await expect(
    changeVoiceLine(db, x.ctx, x.session.id, {
      scope: "line",
      analysisId: part.id,
      expectedVersion: marked.version + 1,
      utteranceId: "t2",
      choice: "mine",
    }),
  ).rejects.toMatchObject({ code: "validation_failed" });
});

it("FR-VOC-004/007 audit: links and line choices hold no vectors, outlive the 24 h vector expiry like the candidates, and go with the analysis", async () => {
  const x = await voiceFixture(db);
  const part = await addPart(x, {
    candidates: [voice("other", 30000)],
    embeddings: [{ speakerId: "other", vector: vector(0, 0.1) }],
    utterances: [
      { id: "o1", speakerId: "other", startMs: 1000, endMs: 3000, text: "I goes.", eligible: true },
    ],
    turnEmbeddings: [{ utteranceId: "o1", vector: vector(7) }],
  });
  await changeVoiceLine(db, x.ctx, x.session.id, {
    scope: "line",
    analysisId: part.id,
    expectedVersion: part.version,
    utteranceId: "o1",
    choice: "not_mine",
  });
  const raw = async () =>
    db.selectFrom("voc.analysis").selectAll().where("session_id", "=", x.session.id).execute();
  let rows = await raw();
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    // No vector outside private_embeddings: not in links, choices, utterances or candidates.
    const { private_embeddings: _vectors, embeddings_expire_at: _expiry, ...rest } = row;
    expect(JSON.stringify(rest)).not.toContain("vector");
    expect(JSON.stringify(rest)).not.toContain("embedding");
    expect(JSON.stringify(row.speaker_links)).not.toContain("[");
  }
  expect(rows.some((row) => Object.keys(row.speaker_links as object).length)).toBe(true);
  // 24 h later the temporary voiceprints are gone; the links and choices stay with the row.
  await expireVoiceEmbeddings(db, new Date(Date.now() + 25 * 3600_000));
  rows = await raw();
  expect(rows.every((row) => JSON.stringify(row.private_embeddings) === "[]")).toBe(true);
  expect(rows.find((row) => row.id === part.id)?.line_choices).toEqual({ o1: "not_mine" });
  expect(rows.some((row) => Object.keys(row.speaker_links as object).length)).toBe(true);
  // Revocation removes the rows, and with them every link and choice.
  await revokeVoiceData(db, x.ctx);
  expect(await raw()).toEqual([]);
});

it("audit item 7: analyses stored before this change still render and still allow confirmation", async () => {
  const x = await voiceFixture(db);
  // What the migration leaves on old rows: the column defaults.
  await db
    .updateTable("voc.analysis")
    .set({ speaker_links: "{}", line_choices: "{}" })
    .where("id", "=", x.analysis.id)
    .execute();
  const view = await getClassVoice(db, x.ctx, x.session.id);
  expect(view.classVoices).toEqual([]);
  expect(view.classCandidateId).toBeNull();
  expect(view.analyses[0]?.lines).toEqual([]);
  expect(view.analyses[0]?.speakerLinks).toEqual({});
  const confirmed = await changeVoiceIdentity(db, x.ctx, x.session.id, {
    action: "confirm",
    analysisId: x.analysis.id,
    expectedVersion: view.analyses[0]?.version ?? 0,
    speakerId: "learner",
  });
  expect(confirmed.status).toBe("verified");
});

it("FR-VOC-005 audit: a line marked as mine shows a mistake only with a second same-voice occurrence", async () => {
  const x = await voiceFixture(db),
    model = referenceStudyModel();
  const part = await addPart(x, {
    candidates: [voice("solo", 30000)],
    embeddings: [{ speakerId: "solo", vector: vector(3) }],
    utterances: [
      {
        id: "s1",
        speakerId: "solo",
        startMs: 1000,
        endMs: 3000,
        text: "She go home.",
        eligible: true,
      },
    ],
  });
  await saveVoiceCandidateMistakes(db, x.ctx, {
    analysisId: part.id,
    profileVersion: x.input.profileVersion,
    mistakes: {
      solo: [
        {
          utteranceId: "s1",
          said: "She **go** home.",
          correct: "She goes home.",
          whyFa: "سوم شخص s می‌گیرد.",
          kind: "grammar",
          teacherCorrected: false,
        },
      ],
    },
  });
  await changeVoiceLine(db, x.ctx, x.session.id, {
    scope: "line",
    analysisId: part.id,
    expectedVersion: part.version,
    utteranceId: "s1",
    choice: "mine",
  });
  // Marked as the learner's, yet without the repeated evidence it is not shown.
  expect(
    renderClassNotesHtml(await projectVerifiedSpeech(db, x.ctx, x.session.id, model)),
  ).not.toContain("She goes home.");
});

it("owner decision 2026-10-13 (question 5): parts are listed in recording order, not by id", async () => {
  const x = await voiceFixture(db);
  const later = await addPart(x, { candidates: [voice("later", 30000)], embeddings: [] });
  const earlier = await addPart(x, { candidates: [voice("earlier", 30000)], embeddings: [] });
  // The third source was registered last, whatever its id sorts like.
  await db
    .updateTable("src.asset")
    .set({ created_at: new Date(x.now.getTime() - 60_000) })
    .where("id", "=", earlier.sourceId)
    .execute();
  const view = await getClassVoice(db, x.ctx, x.session.id);
  expect(view.analyses.map((item) => item.id)).toEqual([earlier.id, x.analysis.id, later.id]);
});
