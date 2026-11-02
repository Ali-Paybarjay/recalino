/**
 * On-device readability check of a board photo (D72 layers 1 and 2). Pure arithmetic on a small
 * RGBA image: no network, no AI and no package (D28). The result only advises the learner to
 * retake while the board is still there; the photo is always kept (PRD-REC-07, PRD-CORE-05).
 *
 * Calibration (2026-10-13): synthetic boards from `test-fixtures/synthetic-board.ts` at 640 px
 * (marker writing at 11 px and 26 px x-height on an unevenly lit board, sensor noise ±4), the
 * same boards box-blurred at radius 1, 2 and 3, darkened, washed out, with a ceiling-light blob,
 * dimmed, with pale ink, with only two lines of writing, an empty board and a chalkboard; then
 * canvas-drawn boards in Chromium (e2e). Each threshold sits between the readable and the
 * unreadable cases, roughly in the middle on a log scale; the measured values are listed next to
 * each constant.
 * No real class photo was used (G11), so the thresholds are a starting point to recheck against
 * the server's `unreadable_image` outcomes (the `photo_quality` diagnostics event).
 */
import type { PhotoVerdict } from "../../shared/capture-diagnostics-contract";

export { PHOTO_VERDICTS, type PhotoVerdict } from "../../shared/capture-diagnostics-contract";
export type PhotoImage = { width: number; height: number; data: Uint8ClampedArray };
export type PhotoQuality = {
  /** Variance of the Laplacian on edge pixels, divided by contrast²; scale-free. */
  sharpness: number;
  exposure: {
    /** Share of pixels darker than `DARK_LEVEL`. */
    dark: number;
    /** Share of clipped pixels (≥ `CLIPPED_LEVEL`). */
    bright: number;
    /** (99th − 1st luminance percentile) / 255. */
    contrast: number;
    /** Median luminance / 255. */
    median: number;
  };
  /** Share of the image covered by the largest saturated, featureless region. */
  glare: number;
  /** Share of pixels on a visible edge (Sobel). */
  edgeDensity: number;
  verdict: PhotoVerdict;
  /** The four diagnostic scores as integers 0–1000, for capture diagnostics (numbers only). */
  scores: { sharpness: number; exposure: number; glare: number; edgeDensity: number };
};

/** Below this, strokes have lost their edges. Sharp 0.55–0.95; blur r1 0.07, r2 0.02, r3 0.01. */
export const MIN_SHARPNESS = 0.04;
/** Median luminance below this is too dark. Dimmed but readable 0.47; under-exposed 0.17. */
export const MIN_MEDIAN = 0.24;
/**
 * A dark photo is only too dark when the writing has lost its contrast too: a chalkboard is dark
 * by nature (median 0.22, contrast 0.71; dimmed 0.12 and 0.39); under-exposed boards keep 0.13.
 */
export const MIN_CONTRAST_WHEN_DARK = 0.35;
/** Washed out: mostly clipped and little contrast. Washed out: 0.96 clipped, contrast 0.23. */
export const MAX_CLIPPED = 0.5;
export const MIN_CONTRAST_WHEN_CLIPPED = 0.35;
/** Largest glare region; the light blob covers 0.07, readable boards 0. */
export const MAX_GLARE = 0.025;
/** Glare is only judged on a board that is not clipped overall (median under this). */
export const GLARE_MAX_MEDIAN = 0.94;
/** Too few edges to hold writing: empty board 0.004, two lines of writing 0.02. */
export const MIN_EDGE_DENSITY = 0.008;
export const DARK_LEVEL = 40;
export const CLIPPED_LEVEL = 250;
/** Edge pixel: Sobel |gx|+|gy| above this share of a full-contrast step (4 × contrast). */
const EDGE_SHARE = 0.15;
/** Floor of the edge threshold, so sensor noise on an empty board is not an edge. */
const EDGE_FLOOR = 40;
/** Glare grid cell (px) and the share of clipped pixels that makes a cell glare. */
const CELL = 8;
const CELL_CLIPPED = 0.9;

const permille = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000);

export function assessPhotoQuality(image: PhotoImage): PhotoQuality {
  const { width, height, data } = image;
  const size = width * height;
  if (width < 3 || height < 3 || data.length < size * 4) throw new Error("Image is too small.");
  const gray = new Float32Array(size);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < size; i++) {
    const j = i * 4;
    const value = ((data[j] ?? 0) * 77 + (data[j + 1] ?? 0) * 150 + (data[j + 2] ?? 0) * 29) / 256;
    gray[i] = value;
    histogram[value | 0] = (histogram[value | 0] ?? 0) + 1;
  }
  const percentile = (share: number) => {
    let count = 0;
    for (let level = 0; level < 256; level++) {
      count += histogram[level] ?? 0;
      if (count >= share * size) return level;
    }
    return 255;
  };
  let dark = 0;
  for (let level = 0; level < DARK_LEVEL; level++) dark += histogram[level] ?? 0;
  let clipped = 0;
  for (let level = CLIPPED_LEVEL; level < 256; level++) clipped += histogram[level] ?? 0;
  const low = percentile(0.01);
  const high = percentile(0.99);
  const range = Math.max(1, high - low);
  const exposure = {
    dark: dark / size,
    bright: clipped / size,
    contrast: range / 255,
    median: percentile(0.5) / 255,
  };

  // One pass for edges (Sobel) and the Laplacian on those edges.
  const threshold = Math.max(EDGE_FLOOR, EDGE_SHARE * 4 * range);
  let edges = 0;
  let sum = 0;
  let squares = 0;
  for (let y = 1; y < height - 1; y++) {
    let i = y * width;
    for (let x = 1; x < width - 1; x++) {
      i++;
      const tl = gray[i - width - 1] ?? 0;
      const t = gray[i - width] ?? 0;
      const tr = gray[i - width + 1] ?? 0;
      const l = gray[i - 1] ?? 0;
      const c = gray[i] ?? 0;
      const r = gray[i + 1] ?? 0;
      const bl = gray[i + width - 1] ?? 0;
      const b = gray[i + width] ?? 0;
      const br = gray[i + width + 1] ?? 0;
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      if (Math.abs(gx) + Math.abs(gy) <= threshold) continue;
      const laplacian = t + l + r + b - 4 * c;
      edges++;
      sum += laplacian;
      squares += laplacian * laplacian;
    }
  }
  const interior = (width - 2) * (height - 2);
  const edgeDensity = edges / interior;
  const sharpness = edges ? (squares / edges - (sum / edges) ** 2) / (range * range) : 0;

  const glare = largestGlare(gray, width, height);
  const verdict: PhotoVerdict =
    exposure.median < MIN_MEDIAN && exposure.contrast < MIN_CONTRAST_WHEN_DARK
      ? "too_dark"
      : exposure.bright > MAX_CLIPPED && exposure.contrast < MIN_CONTRAST_WHEN_CLIPPED
        ? "too_bright"
        : glare > MAX_GLARE && exposure.median < GLARE_MAX_MEDIAN
          ? "glare"
          : edgeDensity < MIN_EDGE_DENSITY
            ? "low_detail"
            : sharpness < MIN_SHARPNESS
              ? "blurry"
              : "ok";
  return {
    sharpness,
    exposure,
    glare,
    edgeDensity,
    verdict,
    scores: {
      // Sharp boards score about 400–950; 1000 means "at least as sharp as the sharpest case".
      sharpness: permille(sharpness),
      exposure: permille(exposure.median),
      glare: permille(glare),
      edgeDensity: permille(edgeDensity),
    },
  };
}

/** Largest 4-connected group of clipped grid cells, as a share of the image. */
function largestGlare(gray: Float32Array, width: number, height: number) {
  const columns = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const cells = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      let count = 0;
      let total = 0;
      for (let y = row * CELL; y < Math.min(height, (row + 1) * CELL); y++)
        for (let x = column * CELL; x < Math.min(width, (column + 1) * CELL); x++) {
          total++;
          if ((gray[y * width + x] ?? 0) >= CLIPPED_LEVEL) count++;
        }
      if (count >= CELL_CLIPPED * total) cells[row * columns + column] = 1;
    }
  let largest = 0;
  const stack: number[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== 1) continue;
    cells[start] = 2;
    stack.push(start);
    let area = 0;
    while (stack.length) {
      const cell = stack.pop() ?? 0;
      area++;
      const column = cell % columns;
      for (const next of [
        column > 0 ? cell - 1 : -1,
        column < columns - 1 ? cell + 1 : -1,
        cell - columns,
        cell + columns,
      ])
        if (next >= 0 && next < cells.length && cells[next] === 1) {
          cells[next] = 2;
          stack.push(next);
        }
    }
    largest = Math.max(largest, area);
  }
  return (largest * CELL * CELL) / (width * height);
}
