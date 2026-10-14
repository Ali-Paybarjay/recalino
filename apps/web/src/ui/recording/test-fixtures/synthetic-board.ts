/**
 * Synthetic board photos for the photo-readability tests (G11: synthetic data only). Pixels are
 * generated in code: a whiteboard with marker "handwriting" of two sizes, plus the degradations
 * a phone photo of a board typically suffers. Deterministic for a given seed.
 */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function blank(width: number, height: number, seed: number, background = 218, noise = 4): Pixels {
  const next = random(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // Uneven room light across the board, as in a real photo.
      const value = background + 10 * Math.sin((x / width) * Math.PI) - 6 * (y / height);
      const n = (next() - 0.5) * 2 * noise;
      const i = (y * width + x) * 4;
      data[i] = value + n - 2;
      data[i + 1] = value + n;
      data[i + 2] = value + n + 3;
      data[i + 3] = 255;
    }
  return { width, height, data };
}

/** Anti-aliased thick segment in a marker colour. */
function line(
  image: Pixels,
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  width: number,
  ink: [number, number, number],
) {
  const pad = width / 2 + 1;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const maxX = Math.min(image.width - 1, Math.ceil(Math.max(x0, x1) + pad));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const maxY = Math.min(image.height - 1, Math.ceil(Math.max(y0, y1) + pad));
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length));
      const distance = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
      const cover = Math.max(0, Math.min(1, width / 2 + 0.5 - distance));
      if (!cover) continue;
      const i = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c++)
        image.data[i + c] = (image.data[i + c] ?? 0) * (1 - cover) + (ink[c] ?? 0) * cover;
    }
}

/** Rows of letter-like glyphs: a heading in large writing and lines of small writing. */
export function boardWithWriting(
  width = 640,
  height = 480,
  { seed = 7, ink = [30, 45, 120] as [number, number, number], lines = 7, background = 218 } = {},
): Pixels {
  const image = blank(width, height, seed, background);
  const next = random(seed * 31 + 5);
  const scale = width / 640;
  for (let row = 0; row < lines; row++) {
    const large = row === 0;
    const xHeight = (large ? 26 : 11) * scale;
    const stroke = (large ? 3.5 : 2) * scale;
    const baseline = (60 + row * 58) * scale;
    let x = 40 * scale;
    while (x < width - 60 * scale) {
      const letters = 2 + Math.floor(next() * 6);
      for (let l = 0; l < letters; l++) {
        const w = xHeight * (0.6 + next() * 0.5);
        let from: [number, number] = [x + next() * w, baseline - next() * xHeight];
        for (let p = 1; p < 4; p++) {
          const to: [number, number] = [
            x + next() * w,
            baseline - next() * xHeight * (next() < 0.2 ? 1.8 : 1),
          ];
          line(image, from, to, stroke, ink);
          from = to;
        }
        x += w + xHeight * 0.25;
      }
      x += xHeight * 1.2;
    }
  }
  return image;
}

/** A dark green-black chalkboard with chalk writing: dark overall, yet readable. */
export const chalkboard = (seed = 17) =>
  boardWithWriting(640, 480, { seed, ink: [225, 228, 220], background: 52 });

/** A clean board with nothing written on it but a faint smudge. */
export function emptyBoard(width = 640, height = 480, seed = 11): Pixels {
  const image = blank(width, height, seed);
  line(image, [200, 300], [420, 310], 30, [200, 202, 206]);
  return image;
}

function map(image: Pixels, f: (value: number) => number): Pixels {
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : f(image.data[i] ?? 0);
  return { ...image, data };
}

/** Separable box blur of the given radius (an out-of-focus or shaken photo). */
export function boxBlur(image: Pixels, radius: number): Pixels {
  const { width, height } = image;
  const pass = (source: Uint8ClampedArray, horizontal: boolean) => {
    const out = new Uint8ClampedArray(source.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            const xx = horizontal ? Math.min(width - 1, Math.max(0, x + k)) : x;
            const yy = horizontal ? y : Math.min(height - 1, Math.max(0, y + k));
            sum += source[(yy * width + xx) * 4 + c] ?? 0;
          }
          out[(y * width + x) * 4 + c] = sum / (2 * radius + 1);
        }
    return out;
  };
  return { width, height, data: pass(pass(image.data, true), false) };
}

/** An under-exposed photo of a dim room. */
export const darken = (image: Pixels, factor = 0.18) => map(image, (v) => v * factor + 4);
/** A photo exposed for a darker scene: the board clips and the marker turns pale. */
export const washOut = (image: Pixels) => map(image, (v) => 175 + v * 0.45);
/** A dimmer but readable photo (for false-alarm checks). */
export const dim = (image: Pixels, factor = 0.55) => map(image, (v) => v * factor);

/** A reflection of a ceiling light: a large saturated white blob over part of the writing. */
export function glare(image: Pixels, cx = 380, cy = 170, radius = 85): Pixels {
  const data = new Uint8ClampedArray(image.data);
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const a = Math.max(0, Math.min(1, (radius * 1.25 - d) / (radius * 0.25)));
      if (!a) continue;
      const i = (y * image.width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = (data[i + c] ?? 0) * (1 - a) + 255 * a;
    }
  return { ...image, data };
}
