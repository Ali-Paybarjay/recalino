import { afterEach, expect, it, vi } from "vitest";
import { workspaceRequest } from "./api";
import { uploadWithConfirmation } from "./upload";

afterEach(() => vi.unstubAllGlobals());
const interrupted = "Upload interrupted. The local original is still saved.";

it("successful PUTs make no extra confirmation request", async () => {
  const confirm = vi.fn();
  await uploadWithConfirmation(
    async () => new Response(null, { status: 201 }),
    confirm,
    interrupted,
  );
  expect(confirm).not.toHaveBeenCalled();
});

it.each([400, 409, 503])(
  "recovers HTTP %s only after authoritative verification",
  async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(Response.json({ confirmed: true }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadWithConfirmation(
      () => fetch("https://private-upload.example/part", { method: "PUT" }),
      () => workspaceRequest("/api/sources/uploads/owned-upload/parts/0", "POST"),
      interrupted,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/sources/uploads/owned-upload/parts/0",
      expect.objectContaining({ method: "POST" }),
    ]);
  },
);

it("a lost PUT response can recover after verification without writing the bytes again", async () => {
  const write = vi.fn().mockRejectedValue(new TypeError("Synthetic response lost"));
  const confirm = vi.fn().mockResolvedValue({ confirmed: true });
  await uploadWithConfirmation(write, confirm, interrupted);
  expect(write).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(1);
});

it("a server checksum rejection prevents upload completion after HTTP 400", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 400 }))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Invalid part",
            details: { fields: { upload: ["checksum_mismatch"] } },
          },
        },
        { status: 422 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const complete = vi.fn();
  const upload = async () => {
    await uploadWithConfirmation(
      () => fetch("https://private-upload.example/part", { method: "PUT" }),
      () => workspaceRequest("/api/sources/uploads/owned-upload/parts/0", "POST"),
      interrupted,
    );
    await complete();
  };
  await expect(upload()).rejects.toThrow(interrupted);
  expect(complete).not.toHaveBeenCalled();
});

it.each([{ confirmed: false }, { state: "queued" }, { confirmed: "true" }, null, undefined])(
  "an unverified confirmation response %j cannot accept the part",
  async (confirmation) => {
    await expect(
      uploadWithConfirmation(
        async () => new Response(null, { status: 400 }),
        async () => confirmation,
        interrupted,
      ),
    ).rejects.toThrow(interrupted);
  },
);

it("a missing part or failed confirmation request leaves the upload interrupted", async () => {
  await expect(
    uploadWithConfirmation(
      async () => new Response(null, { status: 400 }),
      async () => {
        throw new TypeError("Synthetic verification connection lost");
      },
      interrupted,
    ),
  ).rejects.toThrow(interrupted);
});
