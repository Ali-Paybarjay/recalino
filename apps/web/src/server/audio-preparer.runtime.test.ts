import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { audioVerifier } from "./audio-preparer";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), executable: "synthetic-decoder" }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("ffmpeg-static", () => ({
  get default() {
    return mocks.executable;
  },
}));

afterEach(() => {
  vi.useRealTimers();
  mocks.executable = "synthetic-decoder";
  mocks.spawn.mockReset();
});

// The native boundary is controlled here; audio-preparer.test.ts uses real decoding.
function decoder() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => true),
  });
  mocks.spawn.mockReturnValue(child as unknown as ChildProcess);
  return child;
}
const signature = new Uint8Array([0x49, 0x44, 0x33]);

it("keeps a missing decoder retryable instead of rejecting the original", async () => {
  mocks.executable = "";
  await expect(audioVerifier().inspect(signature, "audio/mpeg")).rejects.toMatchObject({
    code: "internal",
    details: { reason: "audio_decoder_unavailable" },
  });
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("keeps decoder startup failures retryable", async () => {
  const child = decoder();
  const inspecting = audioVerifier().inspect(signature, "audio/mpeg");
  const result = expect(inspecting).rejects.toMatchObject({
    code: "internal",
    details: { reason: "audio_decoder_unavailable" },
  });
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
  child.emit(
    "error",
    Object.assign(new Error("synthetic unavailable decoder"), { code: "ENOENT" }),
  );
  child.emit("close", -2, null);
  await result;
});

it("keeps a decoder killed by its host retryable", async () => {
  const child = decoder();
  const inspecting = audioVerifier().inspect(signature, "audio/mpeg");
  const result = expect(inspecting).rejects.toMatchObject({
    code: "internal",
    details: { reason: "audio_decoder_interrupted" },
  });
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
  child.emit("close", null, "SIGKILL");
  await result;
});

it("keeps a timed out decoder retryable", async () => {
  const child = decoder();
  const inspecting = audioVerifier().inspect(signature, "audio/mpeg");
  const result = expect(inspecting).rejects.toMatchObject({
    code: "internal",
    details: { reason: "audio_decoder_timeout" },
  });
  // File I/O runs on the real clock; start the timer replacement just before spawning.
  mocks.spawn.mockImplementation(() => {
    vi.useFakeTimers();
    return child;
  });
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(180000);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  child.emit("close", null, "SIGKILL");
  await result;
});

it("still rejects bytes the decoder cannot read", async () => {
  const child = decoder();
  const inspecting = audioVerifier().inspect(signature, "audio/mpeg");
  const result = expect(inspecting).rejects.toMatchObject({ code: "unsupported_media" });
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
  child.emit("close", 1, null);
  await result;
});
