import type { RunSource } from "../../packages/core/src/proc/contracts";
import { snapshotSourceSchema } from "../../packages/core/src/proc/contracts";
import { snapshotLearnerTeachingContext } from "../../packages/core/src/proc/learner-context";
import type { LessonData } from "./lesson-quality-eval";

/**
 * Synthetic D62/D63 lessons written for this evaluation (2026-10-12): a 128-minute class with
 * board photos, and a short class with structured board photos and one unrelated photo. No
 * real class text, recording or learner is used.
 */
const id = (caseNo: number, sourceNo: number, version: boolean) =>
  `${version ? "cd" : "ce"}${String(caseNo).padStart(6, "0")}-2222-4222-8222-${String(sourceNo).padStart(12, "0")}`;

const topics: { title: string; lines: string[] }[] = [
  {
    title: "used to",
    lines: [
      "We use used to plus the base verb for past habits that are finished now: I used to walk to school.",
      "Be used to plus an -ing form means something is familiar: I am used to getting up early now.",
      "Get used to plus -ing describes the change: She is getting used to driving on the left.",
      "The negative is didn't use to, without d: We didn't use to have a car.",
    ],
  },
  {
    title: "phrasal verbs with take",
    lines: [
      "Take up means start a new hobby: Last year my brother took up the guitar.",
      "Take after means look or behave like an older relative: Anna takes after her grandmother.",
      "Take off has two meanings today: the plane takes off, and you take off your coat.",
      "With a pronoun the object goes in the middle: take it off, never take off it.",
    ],
  },
  {
    title: "present perfect and past simple",
    lines: [
      "Use the past simple with a finished time: I visited Leeds last summer.",
      "Use the present perfect when no finished time is given: I have visited Leeds twice.",
      "Since takes a starting point and for takes a period: since Monday, for three days.",
      "Ever and never often go with the present perfect: Have you ever tried sushi?",
    ],
  },
  {
    title: "polite requests",
    lines: [
      "Would you mind plus -ing is a very polite request: Would you mind opening the window?",
      "To say yes to would you mind, we say no, not at all, because you do not mind.",
      "Could you possibly is softer than can you: Could you possibly lend me your notes?",
      "Do you think you could is also polite and common in British English.",
    ],
  },
  {
    title: "make and do",
    lines: [
      "We say make a mistake, make a decision and make a phone call.",
      "We say do homework, do the shopping and do someone a favour.",
      "Make is often about creating something; do is often about tasks and work.",
      "Do your best, but make an effort: these two are learnt as fixed collocations.",
    ],
  },
  {
    title: "unless",
    lines: [
      "Unless means if not: We will miss the bus unless we leave now.",
      "Do not use a negative after unless when you mean if not: unless it rains, not unless it doesn't rain.",
      "Unless is followed by the present simple for the future: unless you hurry.",
      "Compare: if you don't hurry, you will be late; unless you hurry, you will be late.",
    ],
  },
];
const fillers = [
  "Okay, let's look at another example together.",
  "Can everyone read this one aloud with me?",
  "Good. Now turn to your partner and make one sentence.",
  "Right, any questions before we move on?",
];

function audioClass(caseNo: number, minutes: number, topicCount: number): RunSource {
  const segmentMs = 30_000;
  const count = (minutes * 60_000) / segmentMs;
  const perTopic = Math.ceil(count / topicCount);
  const units = [];
  const blocks = [];
  for (let index = 0; index < count; index++) {
    const topic = topics[Math.floor(index / perTopic) % topics.length];
    if (!topic) throw new Error("fixture_topic");
    const offset = index % perTopic;
    // Teaching lines first, then practice talk with the lines repeated as student models.
    const text =
      offset < topic.lines.length
        ? topic.lines[offset]
        : offset % 3 === 0
          ? `Student model: ${topic.lines[offset % topic.lines.length]}`
          : fillers[offset % fillers.length];
    units.push({
      id: `segment-${index}`,
      kind: "time",
      start: index * segmentMs,
      end: index * segmentMs + segmentMs - 2000,
      status: "extracted",
    });
    blocks.push({
      id: `segment-${index}-text`,
      unitId: `segment-${index}`,
      kind: "transcript",
      text,
      speakerRole: "unknown",
      speakerId: "anonymous-1",
      timeStatus: "exact",
    });
  }
  return snapshotSourceSchema.parse({
    sourceId: id(caseNo, 1, false),
    contentVersionId: id(caseNo, 1, true),
    objectId: null,
    sha256: "c".repeat(64),
    kind: "audio",
    mimeType: "audio/mpeg",
    role: "class_audio",
    durationMs: minutes * 60_000,
    pageCount: null,
    captureAnchor: null,
    ranges: [],
    units,
    blocks,
  });
}

type Layout = "heading" | "list_item" | "table" | "relation" | "example" | "correction" | "text";
function boardPhoto(
  caseNo: number,
  sourceNo: number,
  lines: [Layout, string, boolean?][],
  anchor?: { sourceId: string; offsetMs: number },
  role: RunSource["role"] = "board_photo",
): RunSource {
  return snapshotSourceSchema.parse({
    sourceId: id(caseNo, sourceNo, false),
    contentVersionId: id(caseNo, sourceNo, true),
    objectId: null,
    sha256: "d".repeat(64),
    kind: "image",
    mimeType: "image/jpeg",
    role,
    durationMs: null,
    pageCount: null,
    captureAnchor: anchor ? { ...anchor, state: "recording", timeStatus: "estimated" } : null,
    ranges: [],
    units: [{ id: "image-1", kind: "document", start: 1, status: "extracted" }],
    blocks: lines.map(([type, text, uncertain], index) => ({
      id: `b${index + 1}`,
      unitId: "image-1",
      kind: type === "heading" || type === "list_item" || type === "table" ? type : "paragraph",
      text,
      layout: { type, order: index + 1, ...(uncertain ? { uncertain: true } : {}) },
    })),
  });
}

export interface LessonQualityCase {
  id: string;
  data: LessonData;
}

export function lessonQualityCases(): LessonQualityCase[] {
  const long = audioClass(901, 128, 6);
  const short = audioClass(902, 15, 2);
  const learner = (level: "B1" | "A2") =>
    snapshotLearnerTeachingContext({ level, goal: "general" });
  return [
    {
      id: "LQ-LONG-128",
      data: {
        explanationLanguage: "fa",
        teachingPreferences: { shorterExamples: false },
        learnerContext: learner("B1"),
        lessonContext: { date: "2026-10-12", course: "Everyday English B1" },
        missingSourceIds: [],
        sources: [
          long,
          boardPhoto(
            901,
            2,
            [
              ["heading", "make / do"],
              ["list_item", "make a mistake, make a decision"],
              ["list_item", "do homework, do the shopping"],
              ["correction", "do a mistake → make a mistake"],
            ],
            { sourceId: long.sourceId, offsetMs: 85 * 60_000 },
          ),
          boardPhoto(
            901,
            3,
            [
              ["heading", "unless = if not"],
              ["relation", "unless + present simple → future result"],
              ["example", "We will miss the bus unless we leave now."],
              ["example", "unless it rains (not: unless it doesn't rain)", true],
            ],
            { sourceId: long.sourceId, offsetMs: 110 * 60_000 },
          ),
        ],
      },
    },
    {
      id: "LQ-BOARD-15",
      data: {
        explanationLanguage: "fa",
        teachingPreferences: { shorterExamples: false },
        learnerContext: learner("A2"),
        lessonContext: { date: "2026-10-12", course: "General English A2" },
        missingSourceIds: [],
        sources: [
          short,
          boardPhoto(902, 2, [
            ["heading", "used to"],
            ["table", "past habit | used to + verb | I used to walk to school."],
            ["table", "familiar now | be used to + -ing | I am used to getting up early."],
            ["correction", "I use to live → I used to live"],
          ]),
          boardPhoto(902, 3, [
            ["heading", "take + particle"],
            ["relation", "take up → start a hobby"],
            ["relation", "take after → look like a relative"],
            ["example", "Take it off. (not: take off it)"],
          ]),
          boardPhoto(
            902,
            4,
            [
              ["heading", "Canteen notice"],
              ["text", "The canteen closes at 2 pm on Fridays."],
            ],
            undefined,
            "class_material",
          ),
        ],
      },
    },
  ];
}
