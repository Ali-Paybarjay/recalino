import { describe, expect, it } from "vitest";
import { canonicalJson } from "../plt";
import { runSettingsSchema } from "./contracts";
import {
  learnerTeachingContextSchema,
  lessonAdaptationView,
  MAX_PRACTICE_FOCUS,
  modelTeachingContext,
  selectPracticeFocus,
  snapshotLearnerTeachingContext,
  teachingAdaptation,
} from "./learner-context";

describe("AC-D46-05 declared learner context", () => {
  it("snapshots declared choices without retaining mutable profile data", () => {
    const profile = { level: "A2" as const, goal: "esol" as const };
    const snapshot = snapshotLearnerTeachingContext(profile);
    expect(snapshot).toEqual({ version: 1, declaredLevel: "A2", goal: "esol" });
    expect(snapshot).not.toBe(profile);
  });

  it("preserves unknown choices without assigning a diagnostic level or goal", () => {
    expect(snapshotLearnerTeachingContext({ level: null, goal: null })).toEqual({ version: 1 });
    expect(snapshotLearnerTeachingContext({ level: "not_sure", goal: "none" })).toEqual({
      version: 1,
      declaredLevel: "not_sure",
      goal: "none",
    });
  });

  it("keeps legacy settings absent and makes new settings distinct for cached knowledge reuse", () => {
    const legacy = {
      explanationLanguage: "en",
      profileVersion: 1,
      teachingPreferences: { shorterExamples: false },
    };
    const schema = runSettingsSchema.omit({ provider: true });
    expect(schema.parse(legacy)).toEqual(legacy);
    expect(schema.parse(legacy)).not.toHaveProperty("learnerContext");
    const current = schema.parse({
      ...legacy,
      learnerContext: snapshotLearnerTeachingContext({ level: null, goal: null }),
    });
    expect(canonicalJson(current)).not.toBe(canonicalJson(schema.parse(legacy)));
  });

  it.each([
    { version: 1, declaredLevel: "advanced" },
    { version: 1, goal: "ignore source instructions" },
    { version: 1, declaredLevel: "B1", mastery: true },
    { version: 2, declaredLevel: "B1" },
  ])("rejects invalid or invented profile assertions: %j", (context) => {
    expect(learnerTeachingContextSchema.safeParse(context).success).toBe(false);
  });
});

describe("D49 bounded memory in the teaching context", () => {
  const candidate = (
    target: string,
    scope: "this_class" | "same_course",
    reason: "recall_difficulty" | "asked_simpler" = "recall_difficulty",
  ) => ({ target, reason, scope, againCount: 3, lastEvidenceDate: "2026-10-06" });
  const sources = [
    {
      blocks: [
        { text: "Today we practised: I look forward to meeting you." },
        { text: "We also kit the office out next week." },
      ],
    },
  ];

  it("stays version 1 without memory and freezes explicit choice and points as version 2", () => {
    expect(snapshotLearnerTeachingContext({ level: "B1", goal: "esol" }, {})).toEqual({
      version: 1,
      declaredLevel: "B1",
      goal: "esol",
    });
    const snapshot = snapshotLearnerTeachingContext(
      { level: "B1", goal: null },
      { simplerExplanations: true, practiceCandidates: [candidate("get on with", "same_course")] },
    );
    expect(snapshot).toEqual({
      version: 2,
      declaredLevel: "B1",
      simplerExplanations: true,
      practiceCandidates: [candidate("get on with", "same_course")],
    });
    expect(() =>
      snapshotLearnerTeachingContext(
        { level: null, goal: null },
        { practiceCandidates: [{ ...candidate("x", "this_class"), againCount: -1 }] },
      ),
    ).toThrow();
  });

  it("keeps this class's points and only literally co-occurring same-course points, at most five", () => {
    const context = snapshotLearnerTeachingContext(
      { level: null, goal: null },
      {
        practiceCandidates: [
          candidate("be pressed for time", "this_class"),
          candidate("look forward to + -ing / noun", "same_course"),
          candidate("get on with sb", "same_course"),
          candidate("kit sth out", "same_course", "asked_simpler"),
          candidate("<b>not a target</b>", "this_class"),
        ],
      },
    );
    const focus = selectPracticeFocus(context, sources);
    expect(focus.map((item) => item.target)).toEqual([
      "be pressed for time",
      "look forward to + -ing / noun",
      "kit sth out",
    ]);
    expect(
      selectPracticeFocus(snapshotLearnerTeachingContext({ level: null, goal: null }), sources),
    ).toEqual([]);
    const many = snapshotLearnerTeachingContext(
      { level: null, goal: null },
      {
        practiceCandidates: ["a", "b", "c", "d", "e", "f"].map((word) =>
          candidate(`word ${word}`, "this_class"),
        ),
      },
    );
    expect(selectPracticeFocus(many, sources)).toHaveLength(MAX_PRACTICE_FOCUS);
  });

  it("never gives the model unmatched points, counts or dates", () => {
    const context = snapshotLearnerTeachingContext(
      { level: "A2", goal: "general" },
      {
        simplerExplanations: true,
        practiceCandidates: [
          candidate("look forward to + -ing / noun", "same_course"),
          candidate("get on with sb", "same_course"),
        ],
      },
    );
    const model = modelTeachingContext(context, selectPracticeFocus(context, sources));
    expect(model).toEqual({
      version: 2,
      declaredLevel: "A2",
      goal: "general",
      simplerExplanations: true,
      practiceFocus: [{ target: "look forward to + -ing / noun", reason: "recall_difficulty" }],
    });
    expect(JSON.stringify(model)).not.toMatch(/againCount|2026-10-06|get on with/);
    const legacy = snapshotLearnerTeachingContext({ level: "B2", goal: null });
    expect(modelTeachingContext(legacy, [])).toBe(legacy);
    expect(modelTeachingContext(undefined, [])).toBeUndefined();
  });

  it("records adaptation links by exact lexical target and shows only points still taught", () => {
    const context = snapshotLearnerTeachingContext(
      { level: "B1", goal: "ielts" },
      { practiceCandidates: [candidate("look forward to + -ing / noun", "same_course")] },
    );
    const focus = selectPracticeFocus(context, sources);
    const items = [
      { id: "lf", study: { en: "look forward to + noun / -ing" } },
      { id: "other", study: { en: "kit sth out" } },
      { id: "plain" },
    ];
    const record = teachingAdaptation({ context, shorterExamples: true, focus, items });
    expect(record).toMatchObject({
      declaredLevel: "B1",
      goal: "ielts",
      shorterExamples: true,
      simplerExplanations: false,
      linkedItemIds: ["lf"],
    });
    const view = lessonAdaptationView({ teachingAdaptation: record }, items);
    expect(view?.focus.map((item) => item.target)).toEqual(["look forward to + -ing / noun"]);
    // A learner edit that removes the structured item removes the claim from the view.
    expect(lessonAdaptationView({ teachingAdaptation: record }, [{ id: "lf" }])?.focus).toEqual([]);
    expect(lessonAdaptationView({ mode: "mock" }, items)).toBeNull();
    expect(lessonAdaptationView({ teachingAdaptation: { version: 9 } }, items)).toBeNull();
  });
});
