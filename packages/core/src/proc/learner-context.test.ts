import { describe, expect, it } from "vitest";
import { canonicalJson } from "../plt";
import { runSettingsSchema } from "./contracts";
import { learnerTeachingContextSchema, snapshotLearnerTeachingContext } from "./learner-context";

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
