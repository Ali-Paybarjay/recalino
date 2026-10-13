import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFlags } from "./capture-staging-jobs";

vi.mock("server-only", () => ({}));

afterEach(() => {
  delete process.env.RECALINO_CAPTURE_EARLY_UPLOAD;
  delete process.env.RECALINO_CAPTURE_EARLY_TRANSCRIPTION;
});

describe("D60/D61 kill switches", () => {
  it("are on when unset, so a deployment enables both approved behaviours", () => {
    expect(captureFlags()).toEqual({ earlyUpload: true, earlyTranscription: true });
  });
  it("turn off early transcription alone, or both with early upload", () => {
    process.env.RECALINO_CAPTURE_EARLY_TRANSCRIPTION = "off";
    expect(captureFlags()).toEqual({ earlyUpload: true, earlyTranscription: false });
    process.env.RECALINO_CAPTURE_EARLY_UPLOAD = "off";
    expect(captureFlags()).toEqual({ earlyUpload: false, earlyTranscription: false });
  });
});
