import type { Page } from "@playwright/test";

type MicrophoneMode = "granted" | "denied" | "pending";
type CaptureStats = { requests: number; stopped: number };
type VoiceTestWindow = Window & {
  voiceCaptureStats?: CaptureStats;
  resolveVoiceMicrophone?: () => void;
};

/** A synthetic recorder for UI behavior; it never reads a person's microphone. */
export async function mockMicrophone(page: Page, mode: MicrophoneMode = "granted") {
  await page.addInitScript((mode) => {
    const stats = { requests: 0, stopped: 0 };
    Object.assign(window, { voiceCaptureStats: stats });
    const stream = () => ({
      getTracks: () => [
        {
          stop: () => {
            stats.stopped++;
          },
        },
      ],
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          stats.requests++;
          if (mode === "denied") throw new DOMException("Permission denied", "NotAllowedError");
          if (mode === "pending") {
            return new Promise((resolve) => {
              Object.assign(window, { resolveVoiceMicrophone: () => resolve(stream()) });
            });
          }
          return stream();
        },
      },
    });
    class FakeRecorder {
      static isTypeSupported() {
        return true;
      }
      mimeType = "audio/webm;codecs=opus";
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["synthetic voice"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
  }, mode);
}

export function microphoneStats(page: Page) {
  return page.evaluate(() => (window as VoiceTestWindow).voiceCaptureStats);
}

export function resolvePendingMicrophone(page: Page) {
  return page.evaluate(() => (window as VoiceTestWindow).resolveVoiceMicrophone?.());
}
