import { describe, expect, it } from "vitest";
import { orderSessionMaterial, sessionMaterialRows } from "./material-order";

type Row = {
  assetId: string;
  kind: string;
  anchorSourceId: string | null;
  captureOffsetMs: number | null;
};

const row = (
  assetId: string,
  kind: string,
  anchor: { source: string; offset: number } | null = null,
): Row => ({
  assetId,
  kind,
  anchorSourceId: anchor?.source ?? null,
  captureOffsetMs: anchor?.offset ?? null,
});
const ids = (rows: readonly Row[]) => rows.map((entry) => entry.assetId);

// D106: one list per session, read in the order the class happened.
describe("session material order", () => {
  it("lists audio, then photos, then documents, keeping server order inside each group", () => {
    const rows = [
      row("notes.pdf", "pdf"),
      row("board.jpg", "image"),
      row("part-1", "audio"),
      row("handout.html", "html"),
      row("part-2", "audio"),
      row("words.txt", "text"),
      row("part-3", "audio"),
      row("slides.pdf", "pdf"),
    ];
    expect(ids(orderSessionMaterial(rows))).toEqual([
      "part-1",
      "part-2",
      "part-3",
      "board.jpg",
      "notes.pdf",
      "handout.html",
      "words.txt",
      "slides.pdf",
    ]);
  });

  it("orders photos by the part and the moment they were taken, then the untimed ones", () => {
    const rows = [
      row("upload.jpg", "image"),
      row("part-2-early", "image", { source: "part-2", offset: 5_000 }),
      row("part-1-late", "image", { source: "part-1", offset: 300_000 }),
      row("part-1", "audio"),
      row("part-1-early", "image", { source: "part-1", offset: 20_000 }),
      row("part-2", "audio"),
      row("removed-part", "image", { source: "gone", offset: 1_000 }),
    ];
    expect(ids(orderSessionMaterial(rows))).toEqual([
      "part-1",
      "part-2",
      "part-1-early",
      "part-1-late",
      "part-2-early",
      "removed-part",
      "upload.jpg",
    ]);
  });

  it("keeps server order for equal moments and puts unknown kinds last", () => {
    const rows = [
      row("other", "video"),
      row("second", "image", { source: "part-1", offset: 1_000 }),
      row("first", "image", { source: "part-1", offset: 1_000 }),
      row("part-1", "audio"),
    ];
    expect(ids(orderSessionMaterial(rows))).toEqual(["part-1", "second", "first", "other"]);
  });

  it("returns a new array and leaves the server rows as they were", () => {
    const rows = [row("b", "pdf"), row("a", "audio")];
    const ordered = orderSessionMaterial(rows);
    expect(ordered).not.toBe(rows);
    expect(ids(rows)).toEqual(["b", "a"]);
  });

  it("puts uploads on their way after the saved rows, in the order they were chosen", () => {
    const rows = sessionMaterialRows(
      [row("worksheet", "pdf"), row("part-1", "audio")],
      [{ id: "first-chosen" }, { id: "second-chosen" }],
    );
    expect(rows.map((entry) => `${entry.type}:${entry.key}`)).toEqual([
      "source:part-1",
      "source:worksheet",
      "pending:first-chosen",
      "pending:second-chosen",
    ]);
  });
});
