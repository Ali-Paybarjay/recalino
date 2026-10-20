import { describe, expect, it, vi } from "vitest";
import { showsThumbnail, type ThumbnailIo, ThumbnailLoader } from "./source-thumbnails";

const verifiedPhoto = {
  kind: "image",
  verifiedAt: "2026-10-20T09:00:00Z",
  originalDeletedAt: null,
  rejectionReason: null,
  uploadState: "verified",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets the loader's queue run to its next wait. */
const settle = () => new Promise((done) => setTimeout(done, 0));

function harness(overrides: Partial<ThumbnailIo> = {}) {
  let links = 0;
  const pictures: Array<ReadonlyMap<string, string>> = [];
  const io = {
    deviceCopies: vi.fn(async (): Promise<ReadonlyMap<string, Blob>> => new Map()),
    readLink: vi.fn(async (assetId: string) => {
      links++;
      return `https://storage.example/${assetId}?token=${links}`;
    }),
    objectUrl: vi.fn((_blob: Blob) => "blob:local-photo"),
    revoke: vi.fn(),
    changed: vi.fn((next: ReadonlyMap<string, string>) => {
      pictures.push(next);
    }),
    ...overrides,
  };
  const loader = new ThumbnailLoader(io);
  return { io, loader, latest: () => pictures.at(-1) ?? new Map<string, string>() };
}

// D106: a photo row shows its picture; everything else keeps its icon.
describe("which rows show a picture", () => {
  it("shows a verified photo whose original is kept", () => {
    expect(showsThumbnail(verifiedPhoto)).toBe(true);
  });

  it.each([
    ["audio (never served, D29)", { kind: "audio" }],
    ["a PDF", { kind: "pdf" }],
    ["HTML", { kind: "html" }],
    ["plain text", { kind: "text" }],
    ["an unverified photo", { verifiedAt: null }],
    ["a photo whose original was deleted", { originalDeletedAt: "2026-10-20T10:00:00Z" }],
    ["a rejected photo", { rejectionReason: "checksum_mismatch" }],
    ["a photo whose upload was rejected", { uploadState: "rejected" }],
  ])("keeps the icon for %s", (_, change) => {
    expect(showsThumbnail({ ...verifiedPhoto, ...change })).toBe(false);
  });
});

describe("thumbnail loading", () => {
  it("prefers the copy on this device and never asks the server for it", async () => {
    const blob = new Blob(["synthetic photo"], { type: "image/jpeg" });
    const { io, loader, latest } = harness({
      deviceCopies: vi.fn(async () => new Map([["photo-1", blob]])),
    });
    loader.request("photo-1");
    await settle();
    expect(io.objectUrl).toHaveBeenCalledWith(blob);
    expect(io.readLink).not.toHaveBeenCalled();
    expect(latest().get("photo-1")).toBe("blob:local-photo");
  });

  it("reads each private link once, however often the list refreshes", async () => {
    const { io, loader, latest } = harness();
    loader.request("photo-1");
    loader.request("photo-1");
    await settle();
    loader.request("photo-1");
    loader.keep(new Set(["photo-1"]));
    await settle();
    expect(io.readLink).toHaveBeenCalledTimes(1);
    expect(io.deviceCopies).toHaveBeenCalledTimes(1);
    expect(latest().get("photo-1")).toBe("https://storage.example/photo-1?token=1");
  });

  it("asks for one link at a time", async () => {
    const first = deferred<string>();
    const readLink = vi.fn((assetId: string) =>
      assetId === "photo-1" ? first.promise : Promise.resolve(`https://storage.example/${assetId}`),
    );
    const { loader, latest } = harness({ readLink });
    loader.request("photo-1");
    loader.request("photo-2");
    await settle();
    expect(readLink.mock.calls.map(([assetId]) => assetId)).toEqual(["photo-1"]);
    first.resolve("https://storage.example/photo-1");
    await settle();
    expect(readLink.mock.calls.map(([assetId]) => assetId)).toEqual(["photo-1", "photo-2"]);
    expect([...latest().keys()]).toEqual(["photo-1", "photo-2"]);
  });

  it("loads a picture that failed to show once more, then falls back to the icon", async () => {
    const { io, loader, latest } = harness();
    loader.request("photo-1");
    await settle();
    loader.failed("photo-1", "https://storage.example/photo-1?token=1");
    expect(latest().has("photo-1")).toBe(false);
    await settle();
    expect(latest().get("photo-1")).toBe("https://storage.example/photo-1?token=2");
    loader.failed("photo-1", "https://storage.example/photo-1?token=2");
    await settle();
    expect(latest().has("photo-1")).toBe(false);
    loader.failed("photo-1", "https://storage.example/photo-1?token=2");
    loader.request("photo-1");
    await settle();
    expect(io.readLink).toHaveBeenCalledTimes(2);
  });

  it("falls back to a private link when the device copy cannot be shown", async () => {
    const { io, loader, latest } = harness({
      deviceCopies: vi.fn(async () => new Map([["photo-1", new Blob(["broken"])]])),
    });
    loader.request("photo-1");
    await settle();
    loader.failed("photo-1", "blob:local-photo");
    await settle();
    expect(io.revoke).toHaveBeenCalledWith("blob:local-photo");
    expect(io.readLink).toHaveBeenCalledTimes(1);
    expect(latest().get("photo-1")).toBe("https://storage.example/photo-1?token=1");
  });

  it("ignores an error from a picture it has already replaced", async () => {
    const { io, loader, latest } = harness();
    loader.request("photo-1");
    await settle();
    loader.failed("photo-1", "https://storage.example/earlier-link");
    await settle();
    expect(io.readLink).toHaveBeenCalledTimes(1);
    expect(latest().get("photo-1")).toBe("https://storage.example/photo-1?token=1");
  });

  it("shows the icon without retrying when the link cannot be read", async () => {
    const { io, loader, latest } = harness({
      readLink: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    loader.request("photo-1");
    await settle();
    loader.request("photo-1");
    await settle();
    expect(io.readLink).toHaveBeenCalledTimes(1);
    expect(latest().has("photo-1")).toBe(false);
  });

  it("drops and revokes the picture of a removed photo and never loads it again", async () => {
    const { io, loader, latest } = harness({
      deviceCopies: vi.fn(async () => new Map([["photo-1", new Blob(["photo"])]])),
    });
    loader.request("photo-1");
    await settle();
    loader.forget("photo-1");
    expect(io.revoke).toHaveBeenCalledWith("blob:local-photo");
    expect(latest().has("photo-1")).toBe(false);
    loader.request("photo-1");
    await settle();
    expect(io.objectUrl).toHaveBeenCalledTimes(1);
  });

  it("drops pictures of photos no longer listed and revokes device copies on unmount", async () => {
    let next = 0;
    const { io, loader, latest } = harness({
      deviceCopies: vi.fn(
        async () =>
          new Map([
            ["photo-1", new Blob(["one"])],
            ["photo-2", new Blob(["two"])],
          ]),
      ),
      objectUrl: vi.fn(() => `blob:local-${++next}`),
    });
    loader.request("photo-1");
    loader.request("photo-2");
    await settle();
    loader.keep(new Set(["photo-2"]));
    expect(io.revoke).toHaveBeenCalledWith("blob:local-1");
    expect([...latest().keys()]).toEqual(["photo-2"]);
    loader.dispose();
    expect(io.revoke).toHaveBeenCalledWith("blob:local-2");
    loader.request("photo-3");
    await settle();
    expect(io.objectUrl).toHaveBeenCalledTimes(2);
  });

  it("revokes a device copy that finished loading after the page closed", async () => {
    const copies = deferred<ReadonlyMap<string, Blob>>();
    const { io, loader } = harness({ deviceCopies: vi.fn(() => copies.promise) });
    loader.request("photo-1");
    await settle();
    loader.dispose();
    copies.resolve(new Map([["photo-1", new Blob(["late"])]]));
    await settle();
    expect(io.objectUrl).toHaveBeenCalledTimes(1);
    expect(io.revoke).toHaveBeenCalledWith("blob:local-photo");
    expect(io.changed).not.toHaveBeenCalled();
  });
});
