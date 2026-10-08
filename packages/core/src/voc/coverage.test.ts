import { expect, it } from "vitest";
import { correctionFailureReason } from "./analysis";
import { voiceCoverage, voiceCoverageReason } from "./contracts";

// FR-VOC-002
it("names planned sampling and skipped excerpts as separate coverage disclosures", () => {
  expect(voiceCoverageReason(false, false)).toBeNull();
  expect(voiceCoverageReason(true, false)).toBe("sampled_audio");
  expect(voiceCoverageReason(false, true)).toBe("partial_audio");
  expect(voiceCoverageReason(true, true)).toBe("sampled_partial_audio");
  for (const [reason, coverage] of [
    [null, null],
    ["voice_audio_unusable", null],
    ["sampled_audio", "sampled_audio"],
    ["partial_audio", "partial_audio"],
    ["sampled_partial_audio", "sampled_partial_audio"],
    ["voice_correction_sampled_audio_unavailable", "sampled_audio"],
    ["voice_correction_partial_audio_service_blocked", "partial_audio"],
    ["voice_correction_sampled_partial_audio_unavailable", "sampled_partial_audio"],
  ] as const)
    expect(voiceCoverage(reason)).toBe(coverage);
});

it("keeps each coverage disclosure through a correction failure without doubling it", () => {
  expect(correctionFailureReason("voice_correction_unavailable", null)).toBe(
    "voice_correction_unavailable",
  );
  expect(correctionFailureReason("voice_correction_unavailable", "sampled_audio")).toBe(
    "voice_correction_sampled_audio_unavailable",
  );
  expect(correctionFailureReason("voice_correction_service_blocked", "partial_audio")).toBe(
    "voice_correction_partial_audio_service_blocked",
  );
  expect(correctionFailureReason("voice_correction_unavailable", "sampled_partial_audio")).toBe(
    "voice_correction_sampled_partial_audio_unavailable",
  );
  expect(
    correctionFailureReason(
      "voice_correction_sampled_audio_unavailable",
      "voice_correction_sampled_audio_unavailable",
    ),
  ).toBe("voice_correction_sampled_audio_unavailable");
  expect(correctionFailureReason("voice_reference_revoked", "sampled_audio")).toBe(
    "voice_reference_revoked",
  );
});
