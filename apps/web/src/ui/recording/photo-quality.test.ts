import { describe, expect, it } from "vitest";
import { assessPhotoQuality } from "./photo-quality";
import {
  boardWithWriting,
  boxBlur,
  chalkboard,
  darken,
  dim,
  emptyBoard,
  glare,
  washOut,
} from "./test-fixtures/synthetic-board";

// D72 layer 1: an on-device verdict the learner sees while the board is still there.
const board = boardWithWriting();

describe("assessPhotoQuality (D72, PRD-REC-07)", () => {
  it.each([
    ["a sharp board", board, "ok"],
    ["a board blurred at radius 2", boxBlur(board, 2), "blurry"],
    ["a board blurred at radius 3", boxBlur(board, 3), "blurry"],
    ["an under-exposed board", darken(board), "too_dark"],
    ["a washed-out board", washOut(board), "too_bright"],
    ["a board under a light reflection", glare(board), "glare"],
    ["an empty board", emptyBoard(), "low_detail"],
    ["a blurred chalkboard", boxBlur(chalkboard(), 2), "blurry"],
    ["an under-exposed chalkboard", darken(chalkboard()), "too_dark"],
    ["a chalkboard under a light reflection", glare(chalkboard()), "glare"],
  ] as const)("judges %s as %s", (_, image, verdict) => {
    expect(assessPhotoQuality(image).verdict).toBe(verdict);
  });

  // False alarms would teach the learner to ignore the line.
  it.each([
    ["a dimmer room", dim(board)],
    ["pale marker", boardWithWriting(640, 480, { ink: [120, 130, 150], seed: 3 })],
    ["only two lines of writing", boardWithWriting(640, 480, { lines: 2, seed: 5 })],
    ["a smaller photo", boardWithWriting(320, 240, { seed: 9 })],
    ["another board", boardWithWriting(640, 480, { seed: 13 })],
    // Dark by nature, not under-exposed: chalk keeps its contrast.
    ["a chalkboard", chalkboard()],
    ["a chalkboard in a dimmer room", dim(chalkboard())],
  ])("does not flag %s", (_, image) => {
    expect(assessPhotoQuality(image).verdict).toBe("ok");
  });

  it("keeps blur ordered and reports bounded integer scores without pixels", () => {
    const sharp = assessPhotoQuality(board);
    const soft = assessPhotoQuality(boxBlur(board, 1));
    const blurred = assessPhotoQuality(boxBlur(board, 3));
    expect(sharp.sharpness).toBeGreaterThan(soft.sharpness);
    expect(soft.sharpness).toBeGreaterThan(blurred.sharpness);
    for (const value of Object.values(sharp.scores)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1000);
    }
    expect(Object.keys(sharp.scores).sort()).toEqual([
      "edgeDensity",
      "exposure",
      "glare",
      "sharpness",
    ]);
  });

  it("rejects an image too small to judge", () => {
    expect(() =>
      assessPhotoQuality({ width: 2, height: 2, data: new Uint8ClampedArray(16) }),
    ).toThrow();
  });

  it("assesses a 640 px photo within 60 ms", () => {
    assessPhotoQuality(board);
    const runs = 10;
    const start = performance.now();
    for (let run = 0; run < runs; run++) assessPhotoQuality(board);
    expect((performance.now() - start) / runs).toBeLessThanOrEqual(60);
  });
});
