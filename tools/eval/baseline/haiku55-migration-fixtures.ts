import { z } from "../../../packages/core/node_modules/zod";
import { sha256Hex } from "../../../packages/core/src/plt";
import { type RunSource, snapshotSourceSchema } from "../../../packages/core/src/proc/contracts";
import { snapshotLearnerTeachingContext } from "../../../packages/core/src/proc/learner-context";

export const migrationFixtureSchema = z.strictObject({
  id: z.string(),
  declaredLevel: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
  goal: z.enum(["esol", "ielts", "general", "none"]),
  explanationLanguage: z.string(),
  lessonContext: z.strictObject({ date: z.string(), course: z.string() }),
  teachingPreferences: z.strictObject({ shorterExamples: z.boolean() }),
  sources: z.array(snapshotSourceSchema).min(1),
  missingSourceIds: z.array(z.uuid()),
  expected: z.record(z.string(), z.unknown()),
});
export type MigrationFixture = z.infer<typeof migrationFixtureSchema>;

function source(
  caseNo: number,
  blocks: { id: string; text: string }[],
  kind: "text" | "audio" | "pdf" = "text",
  sourceNo = 1,
): RunSource {
  const id = (version: boolean) =>
    `${version ? "bd" : "ad"}${String(caseNo).padStart(6, "0")}-1111-4111-8111-${String(sourceNo).padStart(12, "0")}`;
  const native = kind !== "text";
  return snapshotSourceSchema.parse({
    sourceId: id(false),
    contentVersionId: id(true),
    objectId: null,
    sha256: sha256Hex(JSON.stringify(blocks)),
    kind,
    mimeType: kind === "audio" ? "audio/wav" : kind === "pdf" ? "application/pdf" : "text/plain",
    role: kind === "audio" ? "class_audio" : "class_material",
    durationMs: kind === "audio" ? blocks.length * 10000 : null,
    pageCount: kind === "pdf" ? blocks.length : null,
    captureAnchor: null,
    ranges: [],
    units: native
      ? blocks.map((_, index) => ({
          id: `unit-${index + 1}`,
          kind: kind === "audio" ? "time" : "page",
          start: kind === "audio" ? index * 10000 : index + 1,
          ...(kind === "audio" ? { end: (index + 1) * 10000 } : {}),
          status: "extracted",
        }))
      : [{ id: "document", kind: "document", start: 1, status: "extracted" }],
    blocks: blocks.map((block, index) => ({
      ...block,
      unitId: native ? `unit-${index + 1}` : "document",
      kind: kind === "audio" ? "transcript" : "paragraph",
      ...(kind === "audio"
        ? { speakerRole: "unknown", speakerId: "anonymous-1", timeStatus: "exact" }
        : {}),
    })),
  });
}
function concept(
  id: string,
  supporting: [RunSource, string][],
  criticalFacts: string[],
  forbiddenErrors: string[],
  sourceExamples: string[],
  lexicalTargets: string[] = [],
) {
  return {
    id,
    criticalFacts,
    forbiddenErrors,
    sourceExamples,
    lexicalTargets,
    supporting: supporting.map(([entry, blockId]) => {
      const block = entry.blocks.find((value) => value.id === blockId);
      if (!block) throw new Error("Invalid synthetic concept block");
      const unit = entry.units.find((value) => value.id === block.unitId);
      if (!unit) throw new Error("Invalid synthetic concept unit");
      return {
        sourceId: entry.sourceId,
        blockId,
        exactSourceRef: {
          sourceId: entry.sourceId,
          contentVersionId: entry.contentVersionId,
          locator:
            entry.kind === "audio"
              ? { kind: "time", startMs: unit.start, endMs: unit.end }
              : entry.kind === "pdf"
                ? { kind: "page", page: unit.start, blockId }
                : { kind: "text", blockId, start: 0, end: Array.from(block.text).length },
        },
      };
    }),
  };
}
/** Shared synthetic builders for later independent fixture sets (no answer keys inside). */
export const migrationSource = source;
export const migrationConcept = concept;
function fixture(
  id: string,
  level: MigrationFixture["declaredLevel"],
  language: string,
  sources: RunSource[],
  concepts: ReturnType<typeof concept>[],
  extra: Record<string, unknown> = {},
): MigrationFixture {
  return migrationFixtureSchema.parse({
    id,
    declaredLevel: level,
    goal: "general",
    explanationLanguage: language,
    lessonContext: { date: "2026-10-08", course: `Fresh migration acceptance lesson ${id}` },
    teachingPreferences: { shorterExamples: level === "A2" },
    sources,
    missingSourceIds: [],
    expected: {
      concepts,
      requiredConceptIds: concepts.map((value) => value.id),
      minimumCoreItems: 2,
      minimumProductionQuestionCoverage:
        "Every production prompt is actionable. Lexical fronts hide the target in gap AND meaning; grammar fronts do not reveal the full answer.",
      attribution: {
        accountOwnerWritingConfirmed: false,
        verifiedLearnerVoice: false,
        teacherRoleConfirmed: false,
        allowedOwnLearnerMistakes: [],
        allowedHomework: [],
        allowedSpeakerRoles: ["unknown"],
        expectedSpeechStatus: sources.some((value) => value.kind === "audio")
          ? "unverified"
          : "no_audio",
        prohibitedAssertions: [
          "A printed model was the account owner's error.",
          "Anonymous speaker was the teacher or account owner.",
          "Teacher assigned homework or assessed mastery without evidence.",
        ],
      },
      pronunciation: {
        lexicalHeadwordIpaMustNotAddUnrelatedSentenceWords: true,
        noAcousticAssessment: true,
      },
      teachingLanguage: language,
      ...extra,
    },
  });
}

// Fresh answer keys are frozen before live calls and are never included in provider input.
export function freshMigrationFixtures(): MigrationFixture[] {
  const first = source(1, [
    {
      id: "advice",
      text: "Advice and information are uncountable in this lesson. Say some advice, a piece of advice and some information, not an advice or informations. Class model: My aunt gave me a useful piece of advice yesterday. Printed task: Correct My aunt gave me an advice yesterday. This demonstration is not learner writing.",
    },
    {
      id: "borrow",
      text: "Borrow means receive something temporarily and return it. Borrow something from someone. Class example: I borrowed a small dictionary from my cousin yesterday. Common combinations: borrow a book, borrow money. Borrow is not the action of giving it to someone.",
    },
    {
      id: "lend",
      text: "Lend means give something temporarily expecting its return. Lend something to someone. Class example: My cousin lent a small dictionary to me yesterday. Common combinations: lend a book, lend money. Past form lent. This lesson contains no actual learner information or homework.",
    },
  ]);
  const second = source(2, [
    {
      id: "must-not",
      text: "Must not or mustn't means prohibition, not absence of necessity. Class example: Visitors must not feed the animals in this park. Printed task: Rewrite Visitors are not allowed to feed the animals using must not. Do not rewrite it using do not have to.",
    },
    {
      id: "no-necessity",
      text: "Do not have to means no necessity; doing the action is still permitted. Class example: Visitors do not have to buy a guidebook for this park. Printed task: Rewrite It is not necessary for visitors to buy a guidebook using do not have to. This is not a learner mistake.",
    },
    {
      id: "had-to",
      text: "For a past obligation use had to, not musted. Class example: We had to leave the park early last Saturday. Printed task: Correct We musted leave the park early last Saturday. The obligation was in the past; no conclusion about today's rule follows.",
    },
  ]);
  const third = source(3, [
    {
      id: "used-to",
      text: "Used to + base verb describes a past habit or state that is no longer true. Class example: I used to work in a crowded office near the station. Printed task: Rewrite I worked in that office in the past, but I no longer do using used to. It does not describe being accustomed now.",
    },
    {
      id: "be-used-to",
      text: "Be used to + noun or -ing means be accustomed to something; to is a preposition. Class example: I am used to working in a crowded office near the station. Do not merge this meaning with the past-habit construction used to work.",
    },
    {
      id: "put-up-with",
      text: "Put up with means tolerate an unpleasant situation. This three-part expression is not separable: put up with it, never put it up with. Class example: I cannot put up with this loud music every evening. Common combinations: put up with noise, put up with delays. No teacher identity or learner answer is supplied.",
    },
  ]);
  const material = source(
    4,
    [
      {
        id: "regret",
        text: "Should have + past participle can criticise or regret a past action that did not occur. Class example: We should have checked the timetable before leaving for the station. This use is advice about the past, not certainty that we checked it. Printed transformation: We did not check the timetable, and that was a mistake. Begin We should have.",
      },
      {
        id: "by-until",
        text: "By six means at or before six, a deadline. Until six means a situation continues up to six. Class examples: Send the application by six. The desk is open until six. For an application deadline, this handout says by six, not until six.",
      },
    ],
    "pdf",
  );
  const audio = source(
    4,
    [
      {
        id: "conflicting-time",
        text: "The printed example says Send the application by six. In this synthetic recording, an unidentified person says Send the application by five. These are different deadlines. No identity has been confirmed, and nothing establishes which deadline governs a real application.",
      },
      {
        id: "on-the-whole",
        text: "On the whole means generally, considering all aspects. Class example: On the whole, the new timetable is easier to understand. Common combinations: on the whole satisfactory, on the whole successful. It does not mean every single detail is satisfactory.",
      },
    ],
    "audio",
    2,
  );
  return [
    fixture(
      "M01",
      "A2",
      "fa",
      [first],
      [
        concept(
          "uncountable-advice-information",
          [[first, "advice"]],
          ["Advice/information uncountable; a piece of advice is grammatical."],
          ["Teach an advice or informations as class model."],
          ["My aunt gave me a useful piece of advice yesterday."],
        ),
        concept(
          "borrow-receive",
          [[first, "borrow"]],
          ["Borrow receives temporarily; borrow from someone."],
          ["Reverse direction of borrowing."],
          ["I borrowed a small dictionary from my cousin yesterday."],
          ["borrow"],
        ),
        concept(
          "lend-give",
          [[first, "lend"]],
          ["Lend gives temporarily; lend to someone; lent is past."],
          ["Reverse lender and borrower."],
          ["My cousin lent a small dictionary to me yesterday."],
          ["lend"],
        ),
      ],
    ),
    fixture(
      "M02",
      "B1",
      "fa",
      [second],
      [
        concept(
          "prohibition",
          [[second, "must-not"]],
          ["Must not prohibits."],
          ["Equate must not with do not have to."],
          ["Visitors must not feed the animals in this park."],
        ),
        concept(
          "absence-of-necessity",
          [[second, "no-necessity"]],
          ["Do not have to removes necessity, not permission."],
          ["Claim no necessity means forbidden."],
          ["Visitors do not have to buy a guidebook for this park."],
        ),
        concept(
          "past-obligation",
          [[second, "had-to"]],
          ["Had to expresses past obligation."],
          ["Teach musted."],
          ["We had to leave the park early last Saturday."],
        ),
      ],
    ),
    fixture(
      "M03",
      "B2",
      "fa",
      [third],
      [
        concept(
          "past-habit",
          [[third, "used-to"]],
          ["Used to + base verb describes former habit/state."],
          ["Equate it with present accustomed state."],
          ["I used to work in a crowded office near the station."],
        ),
        concept(
          "accustomed",
          [[third, "be-used-to"]],
          ["Be used to + -ing/noun describes accustomed state."],
          ["Teach am used to work for this meaning."],
          ["I am used to working in a crowded office near the station."],
        ),
        concept(
          "tolerance-inseparable",
          [[third, "put-up-with"]],
          ["Put up with tolerates; object follows with."],
          ["Teach put it up with."],
          ["I cannot put up with this loud music every evening."],
          ["put up with"],
        ),
      ],
    ),
    fixture(
      "M04",
      "C1",
      "en",
      [material, audio],
      [
        concept(
          "past-regret",
          [[material, "regret"]],
          ["Should have can express regret over a past action not done."],
          ["Infer certainty that we checked."],
          ["We should have checked the timetable before leaving for the station."],
        ),
        concept(
          "deadline-versus-duration",
          [[material, "by-until"]],
          ["By marks deadline; until marks continuing situation."],
          ["Swap by/until in source meanings."],
          ["Send the application by six.", "The desk is open until six."],
        ),
        concept(
          "deadline-contradiction",
          [
            [material, "by-until"],
            [audio, "conflicting-time"],
          ],
          ["Printed six conflicts with anonymous audio five; unresolved."],
          ["Choose actual deadline as verified or assign teacher identity."],
          [],
        ),
        concept(
          "general-view",
          [[audio, "on-the-whole"]],
          ["On the whole generally across all aspects, not every detail."],
          ["Teach every detail without exceptions."],
          ["On the whole, the new timetable is easier to understand."],
          ["on the whole"],
        ),
      ],
      {
        minimumCoreItems: 3,
        prohibitedLanguageFields: ["Persian explanatory prose", "faApprox on any item"],
        contradiction: {
          mustPreserveUncertainty: true,
          competingDeadlines: ["five", "six"],
          sourcesBothCited: true,
        },
      },
    ),
  ];
}

/** No answer-key field can reach the model through this deliberately explicit projection. */
export function migrationInputData(fixture: MigrationFixture) {
  return {
    explanationLanguage: fixture.explanationLanguage,
    teachingPreferences: fixture.teachingPreferences,
    learnerContext: snapshotLearnerTeachingContext({
      level: fixture.declaredLevel,
      goal: fixture.goal,
    }),
    lessonContext: fixture.lessonContext,
    sources: fixture.sources,
    missingSourceIds: fixture.missingSourceIds,
  };
}
