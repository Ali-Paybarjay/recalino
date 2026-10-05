import { describe, expect, it } from "vitest";
import { releaseSubmissionKey, submissionKey } from "./api";

describe("owner mutation intent keys", () => {
  it("reuses a failed request key but starts fresh after confirmed success", () => {
    const holder = { current: new Map<string, string>() };
    const input = { capacity: 12, reason: "Pilot revision" };
    const first = submissionKey(holder, "pilot.configure", input);
    // No completion is recorded when a response is lost.
    expect(submissionKey(holder, "pilot.configure", input)).toBe(first);
    releaseSubmissionKey(holder, "pilot.configure", input);
    expect(submissionKey(holder, "pilot.configure", input)).not.toBe(first);
  });
  it("executes A → B → A allocation changes as three intentional mutations", () => {
    const holder = { current: new Map<string, string>() };
    const keys: string[] = [];
    for (const audio of [36000, 72000, 36000]) {
      const input = {
        userId: "same-user",
        entitlementId: "same-period",
        amounts: { audio },
        reason: "Revised allocation",
      };
      keys.push(submissionKey(holder, "quota.set", input));
      releaseSubmissionKey(holder, "quota.set", input);
    }
    expect(new Set(keys).size).toBe(3);
    expect(holder.current.size).toBe(0);
  });
});
