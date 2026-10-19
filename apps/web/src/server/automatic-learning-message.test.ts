import { describe, expect, it } from "vitest";
import { uploadCopy } from "../ui/workspace/upload-copy";
import { automaticLearningMessage } from "./automatic-learning";

describe("automatic creation recovery guidance", () => {
  it.each([
    ["audio_upload_not_started", uploadCopy.automatic.notStarted],
    ["audio_upload_incomplete", uploadCopy.automatic.incomplete],
  ])("names %s as a lapsed upload whose original can be sent again", (code, text) => {
    expect(automaticLearningMessage("blocked", code)).toBe(text);
    expect(text).toContain("Retry failed attempt");
    expect(text).not.toContain("could not be verified");
  });

  it.each([
    "processing_budget_session",
    "processing_budget_user_month",
    "processing_budget_system_day",
    "processing_budget_system_month",
    "service_processing_paused",
    "service_cost_policy_missing",
    "service_cost_unknown",
    "service_reservation_missing",
    "service_processing_blocked",
  ])("directs %s to operator help without blaming learner allowance", (code) => {
    const message = automaticLearningMessage("blocked", code);
    expect(message).toContain("pilot operator");
    expect(message).toContain("material is saved");
    expect(message).toContain("do not need to upload the same files again");
    expect(message).not.toContain("More allowance is needed");
  });

  const units = (partial: Partial<Record<string, number>>) => ({
    audio: 0,
    document: 0,
    regeneration: 0,
    tts: 0,
    storage: 0,
    ...partial,
  });

  it("FR-QUOTA-007: names each short allowance with what the class needs and what is left", () => {
    expect(
      automaticLearningMessage("blocked", "quota_insufficient", {
        active: true,
        required: units({ audio: 7676, document: 3 }),
        available: units({ audio: 4162, document: 77 }),
      }),
    ).toBe(
      "Your material is saved, but this session needs more allowance than is left. Class audio: 127 min 56 sec needed, 69 min 22 sec left. Ask the pilot operator for more allowance or select less material, then retry. You do not need to upload the same files again.",
    );
    expect(
      automaticLearningMessage("blocked", "quota_insufficient", {
        active: true,
        required: units({ audio: 120, regeneration: 1 }),
        available: units({ audio: 60 }),
      }),
    ).toContain(
      "Class audio: 2 min 0 sec needed, 1 min 0 sec left. New versions: 1 needed, 0 left.",
    );
  });

  it("FR-QUOTA-003, FR-QUOTA-007: explains a missing allowance and one that now covers the class", () => {
    expect(
      automaticLearningMessage("blocked", "quota_insufficient", {
        active: false,
        required: units({ document: 1 }),
        available: units({}),
      }),
    ).toContain("no active processing allowance");
    expect(
      automaticLearningMessage("blocked", "quota_insufficient", {
        active: true,
        required: units({ audio: 0, regeneration: 1 }),
        available: units({ audio: 10, regeneration: 1 }),
      }),
    ).toContain("Your allowance now covers this session. Retry");
  });

  it("keeps learner-unit shortage guidance separate from AI spending", () => {
    expect(automaticLearningMessage("blocked", "quota_insufficient")).toContain(
      "More allowance is needed",
    );
    expect(automaticLearningMessage("blocked", "processing_budget_session")).toContain(
      "session's AI spending limit",
    );
  });

  it.each(["provider_http_400", "provider_request_schema_too_complex"])(
    "explains %s as a service request failure without asking for duplicate uploads",
    (code) => {
      const message = automaticLearningMessage("blocked", code);
      expect(message).toContain("AI service rejected");
      expect(message).toContain("needs a fix before retrying");
      expect(message).toContain("do not need to upload the same files again");
    },
  );

  it("does not promise automatic retry for an uncertain paid outcome", () => {
    expect(automaticLearningMessage("blocked", "provider_outcome_unknown")).toContain(
      "Contact the operator before retrying",
    );
  });
});
