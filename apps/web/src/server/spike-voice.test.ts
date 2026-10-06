import type { Database } from "@recalino/core/db";
import { afterEach, describe, expect, it, vi } from "vitest";

const { smoke } = vi.hoisted(() => ({ smoke: vi.fn() }));
vi.mock("./voice-engine", () => ({ checkVoiceRuntime: smoke }));
vi.mock("@recalino/core/plt/vercel-blob", () => ({ VercelBlobStore: class {} }));
vi.mock("./jobs", () => ({ runJobsSoon: vi.fn() }));

import { spikeHandler } from "./spike";

const token = "synthetic-operator-token-for-a-unit-test";
function invoke(given?: string, input: unknown = {}, action = "voice-runtime") {
  const headers = new Headers();
  if (given) headers.set("x-spike-token", given);
  return spikeHandler()({
    request: new Request(`https://example.test/dev/spike/${action}`, {
      method: "POST",
      headers,
    }),
    input,
    ctx: { userId: null, route: "spike", requestId: "unit-test" },
    db: {} as Database,
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  smoke.mockReset();
});
describe("guarded native voice runtime smoke", () => {
  it("returns 404 before inference for a disabled, missing or wrong operator token", async () => {
    vi.stubEnv("SPIKE_TOKEN", token);
    vi.stubEnv("RECALINO_SPIKE", "0");
    await expect(invoke(token)).rejects.toMatchObject({ status: 404 });
    vi.stubEnv("RECALINO_SPIKE", "1");
    await expect(invoke()).rejects.toMatchObject({ status: 404 });
    await expect(invoke("wrong")).rejects.toMatchObject({ status: 404 });
    expect(smoke).not.toHaveBeenCalled();
  });
  it("uses only internal synthetic PCM and returns no vectors, audio or filesystem paths", async () => {
    vi.stubEnv("SPIKE_TOKEN", token);
    vi.stubEnv("RECALINO_SPIKE", "1");
    smoke.mockResolvedValue({
      modelRevision: "pinned-revision",
      durationMs: 1234,
      embedding: [1, 2],
      path: "/private",
    });
    expect(await invoke(token)).toEqual({
      body: { passed: true, modelRevision: "pinned-revision", elapsedMs: 1234 },
    });
    expect(smoke).toHaveBeenCalledWith();
    await expect(invoke(token, { audio: "forbidden" })).rejects.toThrow();
    expect(smoke).toHaveBeenCalledTimes(1);
  });
  it("allows an expiring release credential only for synthetic voice inference", async () => {
    vi.stubEnv("SPIKE_TOKEN", "existing-operator-credential-stays-unchanged");
    vi.stubEnv("RECALINO_SPIKE", "0");
    vi.stubEnv("VOICE_RELEASE_CHECK_TOKEN", token);
    vi.stubEnv(
      "VOICE_RELEASE_CHECK_EXPIRES_AT",
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    );
    smoke.mockResolvedValue({ modelRevision: "pinned-revision", durationMs: 1234 });
    expect(await invoke(token)).toEqual({
      body: { passed: true, modelRevision: "pinned-revision", elapsedMs: 1234 },
    });
    await expect(invoke(token, {}, "ffmpeg")).rejects.toMatchObject({ status: 404 });
    await expect(invoke(token, {}, "cleanup")).rejects.toMatchObject({ status: 404 });
    await expect(invoke("wrong")).rejects.toMatchObject({ status: 404 });
    expect(smoke).toHaveBeenCalledTimes(1);
  });
  it("rejects expired, invalid, overlong and short-token release credentials before inference", async () => {
    vi.stubEnv("SPIKE_TOKEN", "");
    vi.stubEnv("RECALINO_SPIKE", "0");
    vi.stubEnv("VOICE_RELEASE_CHECK_TOKEN", token);
    for (const expiry of [
      new Date(Date.now() - 1000).toISOString(),
      "invalid",
      new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
    ]) {
      vi.stubEnv("VOICE_RELEASE_CHECK_EXPIRES_AT", expiry);
      await expect(invoke(token)).rejects.toMatchObject({ status: 404 });
    }
    vi.stubEnv(
      "VOICE_RELEASE_CHECK_EXPIRES_AT",
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    );
    vi.stubEnv("VOICE_RELEASE_CHECK_TOKEN", "short");
    await expect(invoke("short")).rejects.toMatchObject({ status: 404 });
    expect(smoke).not.toHaveBeenCalled();
  });
});
