import { expect, it } from "vitest";
import { expiredUploadCode } from "./maintenance";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";

// FR-SRC-007: only the verifier's refusal says the audio failed; a lapsed upload can be resent.
it.each([
  [new Map<string, string>(), "audio_upload_not_started"],
  [new Map([[first, "pending"]]), "audio_upload_incomplete"],
  [new Map([[first, "verified"]]), "audio_upload_incomplete"],
  [
    new Map([
      [first, "verified"],
      [second, "rejected"],
    ]),
    "audio_upload_rejected",
  ],
])("names an expired upload with receipts %o as %s", (receipts, code) => {
  expect(expiredUploadCode([first, second], receipts)).toBe(code);
});
