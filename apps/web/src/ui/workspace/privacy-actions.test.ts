import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { RecordingController } from "../recording/controller";
import { IndexedRecordingStore } from "../recording/store";
import { type PendingDeletion, requestKey, WorkspaceRequestError, workspaceRequest } from "./api";
import {
  DeletionOutcomeUnknownError,
  type DeletionReceipt,
  submitAccountDeletion,
} from "./privacy-actions";

afterEach(() => vi.unstubAllGlobals());
function capture() {
  const store = new IndexedRecordingStore();
  const getStream = vi.fn<() => Promise<MediaStream>>();
  const controller = new RecordingController(randomUUID(), store, {
    getStream,
    makeRecorder: vi.fn(),
    clock: () => 0,
  });
  return { store, getStream, controller };
}
it("a failed pre-commit deletion releases capture without claiming deletion", async () => {
  const { controller } = capture();
  await expect(
    submitAccountDeletion(controller, async () => {
      throw new WorkspaceRequestError("Invalid confirmation", "validation_failed");
    }),
  ).rejects.toThrow("Invalid confirmation");
  expect(controller.state.accountDeletionBlocked).toBe(false);
});

it("a pending durable acknowledgement blocks capture and keeps device data through retry failures", async () => {
  const { controller, store, getStream } = capture();
  const now = new Date().toISOString();
  await store.put({
    id: randomUUID(),
    userId: controller.userId,
    sessionId: null,
    mimeType: "audio/webm",
    status: "saved",
    createdAt: now,
    updatedAt: now,
    activeMs: 0,
    chunks: 0,
    bytes: 0,
    creationKey: randomUUID(),
    sourceAssetId: null,
  });
  const pending: PendingDeletion = {
    requestId: randomUUID(),
    kind: "account",
    state: "acknowledgement_pending",
  };
  const response = Response.json(
    { error: { code: "internal", message: "Try again.", details: { deletion: pending } } },
    { status: 500 },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(
    submitAccountDeletion(controller, () => workspaceRequest("/api/privacy/account", "DELETE")),
  ).rejects.toMatchObject({ deletion: pending });
  expect(controller.state.accountDeletionBlocked).toBe(true);
  await expect(controller.start()).rejects.toThrow("Account deletion is in progress");
  expect(getStream).not.toHaveBeenCalled();
  expect(await store.list(controller.userId)).toHaveLength(1);
  await expect(
    submitAccountDeletion(
      controller,
      async () => {
        throw new TypeError("Synthetic connection lost");
      },
      true,
    ),
  ).rejects.toBeInstanceOf(DeletionOutcomeUnknownError);
  expect(controller.state.accountDeletionBlocked).toBe(true);
  expect(await store.list(controller.userId)).toHaveLength(1);
  const accepted: DeletionReceipt = { id: pending.requestId, state: "pending", requestedAt: now };
  expect(await submitAccountDeletion(controller, async () => accepted, true)).toEqual(accepted);
  controller.releaseAccountDeletion();
  await expect(controller.start()).rejects.toThrow("Account deletion is in progress");
  await store.removeAccount(controller.userId);
  expect(await store.list(controller.userId)).toHaveLength(0);
});

it("an invalid deletion identifier is not trusted and keeps the unknown request blocked", async () => {
  const { controller } = capture();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "internal",
            message: "Try again.",
            details: {
              deletion: {
                requestId: "invalid-identifier",
                kind: "account",
                state: "acknowledgement_pending",
              },
            },
          },
        },
        { status: 500 },
      ),
    ),
  );
  await expect(
    submitAccountDeletion(controller, () => workspaceRequest("/api/privacy/account", "DELETE")),
  ).rejects.toBeInstanceOf(DeletionOutcomeUnknownError);
  expect(controller.state.accountDeletionBlocked).toBe(true);
});

it("the first unknown network outcome blocks capture and checks the same request key", async () => {
  const { controller, getStream } = capture();
  const accepted: DeletionReceipt = {
    id: randomUUID(),
    state: "pending",
    requestedAt: new Date().toISOString(),
  };
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Synthetic response lost after commit"))
    .mockResolvedValueOnce(Response.json(accepted, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  const holder = { current: null as { payload: string; key: string } | null };
  const send = () =>
    workspaceRequest<DeletionReceipt>(
      "/api/privacy/account",
      "DELETE",
      { confirm: "DELETE" },
      requestKey(holder, { action: "delete_account" }),
    );
  await expect(submitAccountDeletion(controller, send)).rejects.toBeInstanceOf(
    DeletionOutcomeUnknownError,
  );
  expect(controller.state.accountDeletionBlocked).toBe(true);
  await expect(controller.start()).rejects.toThrow("Account deletion is in progress");
  expect(getStream).not.toHaveBeenCalled();
  expect(await submitAccountDeletion(controller, send, true)).toEqual(accepted);
  const firstKey = fetchMock.mock.calls[0]?.[1]?.headers["Idempotency-Key"];
  expect(firstKey).toBeTruthy();
  expect(fetchMock.mock.calls[1]?.[1]?.headers["Idempotency-Key"]).toBe(firstKey);
  expect(controller.state.accountDeletionBlocked).toBe(true);
});
