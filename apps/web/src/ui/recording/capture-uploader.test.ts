import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CaptureUploader } from "./capture-uploader";
import type { CaptureState } from "./controller";
import type { Recording } from "./store";

const userId = randomUUID();
const sessionId = randomUUID();
const captureId = randomUUID();
function part(segment: number, patch: Partial<Recording> = {}): Recording {
  return {
    id: randomUUID(),
    userId,
    sessionId,
    captureId,
    segment,
    creationKey: randomUUID(),
    sourceAssetId: null,
    autoRegister: true,
    autoGenerate: true,
    mimeType: "audio/webm;codecs=opus",
    status: "saved",
    activeMs: 600000,
    chunks: 120,
    bytes: 5,
    createdAt: new Date(Date.UTC(2026, 9, 12, 8, 49 + segment * 10)).toISOString(),
    updatedAt: new Date().toISOString(),
    measuredBy: "media",
    ...patch,
  };
}

function harness(options: { earlyUpload?: boolean; failStaging?: boolean } = {}) {
  const rows = new Map<string, Recording>();
  let state: CaptureState = {
    recording: null,
    phase: "idle",
    error: null,
    accountDeletionBlocked: false,
  };
  const listeners = new Set<() => void>();
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const manifestStates = new Map<string, string[]>();
  let now = 0;
  let confirmedParts = 0;
  const request = vi.fn(async (path: string, method: string, body?: unknown) => {
    calls.push({ path, method, body });
    if (path.endsWith("/capture"))
      return {
        earlyUpload: options.earlyUpload ?? true,
        earlyTranscription: options.earlyUpload ?? true,
        openUntil: null,
      };
    if (path === "/api/recordings") return { assetId: `asset-${calls.length}` };
    if (path.includes("/audio/staged")) {
      if (options.failStaging) throw new TypeError("offline");
      const action = (body as { action?: string } | undefined)?.action;
      if (method === "POST" && action === "start")
        return { uploadId: `upload-${path}`, state: "pending" };
      if (method === "POST" && action === "confirm_part") {
        // Stored only once a PUT happened since the last confirmed part.
        const confirmed = put.mock.calls.length > confirmedParts;
        if (confirmed) confirmedParts++;
        return { confirmed };
      }
      if (method === "POST" && action === "complete") return { state: "pending", jobId: "job" };
      if (path.includes("index=")) return { url: "https://blob.example/part" };
      const queue = manifestStates.get(path.split("?")[0] ?? "") ?? [];
      return { state: queue.shift() ?? "verified", parts: [] };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const put = vi.fn(async () => ({ ok: true, status: 200 }));
  const report = vi.fn();
  const store = {
    get: async (_user: string, id: string) => rows.get(id) ?? null,
    list: async () => [...rows.values()],
    blob: async () => new Blob(["audio"]),
    updateRegistration: async (_user: string, id: string, patch: Partial<Recording>) => {
      const row = rows.get(id);
      if (!row) return null;
      const next = { ...row, ...patch };
      rows.set(id, next);
      return next;
    },
  };
  const uploader = new CaptureUploader(
    userId,
    store,
    {
      snapshot: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      attachSession: async () => {},
      report,
    },
    {
      request: request as never,
      online: () => true,
      partBytes: async () => 8 * 1024 * 1024,
      put,
      hash: async () =>
        ({
          sha256: "a".repeat(64),
          parts: [{ index: 0, sizeBytes: 5, sha256: "a".repeat(64) }],
        }) as never,
      now: () => now,
      repeat: () => () => {},
      settleMs: 60000,
      pollMs: 1,
    },
  );
  const publish = (next: Partial<CaptureState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  return {
    rows,
    calls,
    request,
    put,
    report,
    uploader,
    publish,
    manifestStates,
    advance: (ms: number) => (now += ms),
    state: () => state,
  };
}

describe("capture uploader (D60, PRD-REC-02)", () => {
  it("registers and stages sealed parts in capture order while the current part keeps recording", async () => {
    const test = harness();
    const first = part(1);
    const second = part(2);
    const current = part(3, { status: "recording", bytes: 0 });
    for (const row of [second, current, first]) test.rows.set(row.id, row);
    test.uploader.start();
    test.publish({ phase: "recording", recording: current });
    await vi.waitFor(() => expect(test.report).toHaveBeenCalledTimes(2), { timeout: 20000 });
    await test.uploader.idle();
    const registered = test.calls.filter((call) => call.path === "/api/recordings");
    expect(registered.map((call) => (call.body as { displayName: string }).displayName)).toEqual([
      "Session recording 2026-10-12 · Part 1",
      "Session recording 2026-10-12 · Part 2",
    ]);
    expect(test.calls[0]).toMatchObject({
      path: `/api/classes/${sessionId}/capture`,
      body: { action: "open" },
    });
    expect(test.put).toHaveBeenCalledTimes(2);
    expect(test.report.mock.calls.map(([segment, result]) => [segment, result])).toEqual([
      [1, "staged"],
      [2, "staged"],
    ]);
    // The part still recording is never registered or sent.
    expect(test.rows.get(current.id)?.sourceAssetId).toBeNull();
    // Nothing about staging reaches the capture state shown to the learner.
    expect(test.state().error).toBeNull();
    expect(test.calls.some((call) => (call.body as { action?: string })?.action === "close")).toBe(
      false,
    );
  });

  it("stays silent when staging fails during capture and leaves the part to the usual upload", async () => {
    const test = harness({ failStaging: true });
    const first = part(1);
    const current = part(2, { status: "recording", bytes: 0 });
    for (const row of [first, current]) test.rows.set(row.id, row);
    test.uploader.start();
    test.publish({ phase: "recording", recording: current });
    await vi.waitFor(
      () => expect(test.report).toHaveBeenCalledWith(1, "failed", expect.any(Number)),
      { timeout: 10000 },
    );
    expect(test.state()).toMatchObject({ phase: "recording", error: null });
    // A failed part is not retried during capture.
    test.publish({ phase: "recording", recording: { ...current, chunks: 2 } });
    await test.uploader.idle();
    expect(test.report).toHaveBeenCalledTimes(1);
  });

  it("does nothing beyond opening the lease when the kill switch is off", async () => {
    const test = harness({ earlyUpload: false });
    const first = part(1);
    test.rows.set(first.id, first);
    test.uploader.start();
    test.publish({ phase: "recording", recording: part(2, { status: "recording", bytes: 0 }) });
    await test.uploader.idle();
    expect(test.calls.map((call) => call.path)).toEqual([`/api/classes/${sessionId}/capture`]);
    expect(test.rows.get(first.id)?.sourceAssetId).toBeNull();
  });

  it("after Stop stages the last part, waits for its verification, then releases the lease", async () => {
    const test = harness();
    const first = part(1);
    test.rows.set(first.id, first);
    const current = part(2, { status: "recording", bytes: 0 });
    test.rows.set(current.id, current);
    test.uploader.start();
    test.publish({ phase: "recording", recording: current });
    await vi.waitFor(() => expect(test.report).toHaveBeenCalledTimes(1));
    await test.uploader.idle();
    const last = {
      ...current,
      status: "saved" as const,
      bytes: 5,
      completedAt: new Date().toISOString(),
    };
    test.rows.set(current.id, last);
    test.publish({ phase: "saved", recording: last });
    await vi.waitFor(() =>
      expect(
        test.calls.some((call) => (call.body as { action?: string })?.action === "close"),
      ).toBe(true),
    );
    const order = test.calls.map(
      (call) => (call.body as { action?: string } | undefined)?.action ?? `${call.method}`,
    );
    // The lease closes only after the last part was completed and its manifest read.
    expect(order.lastIndexOf("complete")).toBeLessThan(order.indexOf("close"));
    expect(test.report.mock.calls.map(([segment]) => segment)).toEqual([1, 2]);
  });
});
