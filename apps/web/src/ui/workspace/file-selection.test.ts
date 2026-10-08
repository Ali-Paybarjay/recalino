import type { InputContract } from "@recalino/core/src";
import { describe, expect, it } from "vitest";
import { appendSelectedFiles, selectedFileProblem } from "./file-selection";

const contract: InputContract = {
  version: "test",
  noticeVersion: "test",
  maxSourcesPerSession: 20,
  partBytes: 100,
  uploadTtlSeconds: 60,
  maxPartAttempts: 3,
  maxRanges: 10,
  htmlMaxNodes: 100,
  htmlMaxDepth: 10,
  formats: {
    audio: { mimeTypes: ["audio/mpeg"], maxBytes: 5_000_000, maxDurationMs: 60_000 },
    image: { mimeTypes: ["image/jpeg"], maxBytes: 2_000_000, maxPixels: 1_000_000 },
    pdf: { mimeTypes: ["application/pdf"], maxBytes: 3_000_000, maxPages: 100 },
    html: { mimeTypes: ["text/html"], maxBytes: 1_500_000 },
    text: { mimeTypes: ["text/plain"], maxBytes: 1_000_000 },
  },
};

function file(name = "notes.txt", options: FilePropertyBag = {}) {
  return new File(["class material"], name, {
    type: "text/plain",
    lastModified: 100,
    ...options,
  });
}

describe("staged file selection", () => {
  it("keeps earlier selections when the picker is reopened and preserves their ids", () => {
    const first = file("first.txt");
    const second = file("second.txt");
    const original = appendSelectedFiles([], [first]);
    const next = appendSelectedFiles(original, [second]);

    expect(next.map((entry) => entry.file)).toEqual([first, second]);
    expect(next[0]).toBe(original[0]);
    expect(next[0]?.id).toBe(original[0]?.id);
    expect(next[1]?.id).not.toBe(next[0]?.id);
    expect(original).toHaveLength(1);
  });

  it("does not accumulate duplicate files across picker visits or within one selection", () => {
    const original = appendSelectedFiles([], [file(), file()]);
    const next = appendSelectedFiles(original, [file(), file(), file("other.txt")]);

    expect(original).toHaveLength(1);
    expect(next.map((entry) => entry.file.name)).toEqual(["notes.txt", "other.txt"]);
    expect(next[0]?.id).toBe(original[0]?.id);
  });

  it("allows different files with the same name and a removed file to be selected again", () => {
    const selected = appendSelectedFiles([], [file(), file("notes.txt", { lastModified: 200 })]);
    expect(selected).toHaveLength(2);

    const removed = selected.filter((entry) => entry.id !== selected[0]?.id);
    const next = appendSelectedFiles(removed, [file(), file()]);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(selected[1]);
    expect(next[1]?.id).not.toBe(selected[0]?.id);
  });

  it("preserves files with different contents size or MIME type instead of conflating them", () => {
    const first = file();
    const differentSize = new File(["longer class material"], first.name, {
      type: first.type,
      lastModified: first.lastModified,
    });
    const differentType = file(first.name, { type: "application/octet-stream" });
    expect(appendSelectedFiles([], [first, differentSize, differentType])).toHaveLength(3);
  });
});

describe("file validation before upload", () => {
  it.each([
    "photo.JPG",
    "photo.jpeg",
    "photo.png",
    "photo.webp",
    "photo.HEIC",
    "photo.heif",
    "material.PDF",
    "material.htm",
    "material.html",
    "material.xhtml",
    "material.txt",
    "recording.m4a",
    "recording.mp3",
    "recording.wav",
    "recording.webm",
    "recording.ogg",
  ])("accepts supported material %s without requiring browser MIME metadata", (name) => {
    expect(selectedFileProblem(file(name, { type: "" }), contract)).toBeUndefined();
  });

  it("explains how to replace an unsupported file", () => {
    expect(selectedFileProblem(file("material.docx"), contract)).toMatch(/Unsupported.*Replace/);
  });

  it("rejects an empty supported file before upload", () => {
    const empty = new File([], "empty.pdf", { type: "application/pdf" });
    expect(selectedFileProblem(empty, contract)).toMatch(/empty.*Choose a file with content/);
  });

  it.each([
    ["recording.mp3", "audio", "5.0"],
    ["photo.heic", "image", "2.0"],
    ["material.pdf", "pdf", "3.0"],
    ["material.html", "html", "1.5"],
    ["material.txt", "text", "1.0"],
  ] as const)("uses the server's size limit for %s", (name, kind, limit) => {
    const oversized = file(name);
    Object.defineProperty(oversized, "size", { value: contract.formats[kind].maxBytes + 1 });
    expect(selectedFileProblem(oversized, contract)).toContain(`up to ${limit} MB`);

    const atLimit = file(name);
    Object.defineProperty(atLimit, "size", { value: contract.formats[kind].maxBytes });
    expect(selectedFileProblem(atLimit, contract)).toBeUndefined();
  });
});
