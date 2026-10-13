import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RecorderTimeline } from "./media-timeline";

// Synthetic tones recorded by Chromium's MediaRecorder and encoded by ffmpeg; see test-fixtures/README.md.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./test-fixtures/${name}`, import.meta.url)));

function read(bytes: Uint8Array, step: number) {
  const timeline = new RecorderTimeline();
  for (let at = 0; at < bytes.length; at += step) timeline.push(bytes.subarray(at, at + step));
  return timeline.read();
}

function box(type: string, ...parts: Uint8Array[]) {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
function words(...values: number[]) {
  const out = new Uint8Array(values.length * 4);
  values.forEach((value, i) => {
    new DataView(out.buffer).setUint32(i * 4, value);
  });
  return out;
}
/** A fragmented MP4 with 20 ms samples at 1 kHz and the given fragment start times. */
function fragmentedMp4(fragments: { start: number; samples: number }[]) {
  const movie = box(
    "moov",
    box("trak", box("mdia", box("mdhd", words(0, 0, 0, 1000, 0)))),
    box("mvex", box("trex", words(0, 1, 1, 20, 0, 0))),
  );
  return [
    box("ftyp", new TextEncoder().encode("iso6")),
    movie,
    ...fragments.flatMap(({ start, samples }) => [
      box(
        "moof",
        box(
          "traf",
          box("tfhd", words(0, 1)),
          box("tfdt", words(0, start)),
          box("trun", words(0, samples)),
        ),
      ),
      box("mdat", new Uint8Array(samples * 3)),
    ]),
  ];
}

describe("recorder timeline (PRD-REC-05)", () => {
  it.each([1, 7, 997, 1 << 20])(
    "measures the audio a Chromium recording actually holds across a capture gap (chunks of %i bytes)",
    (step) => {
      // 2 s of audio, 4 s with no audio reaching the recorder, then 2 s: the 2026-10-12 shape.
      const reading = read(fixture("chromium-gap.webm"), step);
      expect(reading).toMatchObject({ kind: "webm", measured: true });
      // ffmpeg decodes 4020 ms of PCM from this file; the device clock ran for about 8 s.
      expect(reading.mediaMs).toBeGreaterThan(3950);
      expect(reading.mediaMs).toBeLessThan(4100);
      expect(reading.jumpMs).toBeGreaterThan(3900);
    },
  );

  it("does not count an explicit pause as audio", () => {
    // 2.5 s recorded, 1.5 s paused, 2 s recorded; ffmpeg decodes 4500 ms.
    const reading = read(fixture("chromium-pause.webm"), 4096);
    expect(reading.measured).toBe(true);
    expect(reading.mediaMs).toBeGreaterThan(4400);
    expect(reading.mediaMs).toBeLessThan(4600);
    expect(reading.jumpMs).toBe(0);
  });

  it.each([1, 13, 4096])("reads fragmented MP4 sample durations (chunks of %i bytes)", (step) => {
    // A 3 s AAC tone; ffmpeg decodes 3042 ms including encoder priming.
    const reading = read(fixture("fragmented.mp4"), step);
    expect(reading).toMatchObject({ kind: "mp4", measured: true, jumpMs: 0 });
    expect(reading.mediaMs).toBeGreaterThan(2990);
    expect(reading.mediaMs).toBeLessThan(3060);
  });

  it("separates MP4 fragments that start after a discontinuity", () => {
    const timeline = new RecorderTimeline();
    for (const part of fragmentedMp4([
      { start: 0, samples: 50 },
      { start: 5000, samples: 50 },
    ]))
      timeline.push(part);
    expect(timeline.read()).toMatchObject({ measured: true, mediaMs: 2000, jumpMs: 4000 });
  });

  it("falls back for an unknown container or a stream it cannot follow", () => {
    const unknown = new RecorderTimeline();
    unknown.push(new TextEncoder().encode("not a container at all"));
    expect(unknown.read()).toMatchObject({ kind: "unknown", measured: false });

    const broken = new RecorderTimeline();
    const bytes = fixture("chromium-gap.webm");
    broken.push(bytes);
    // A zero byte can never start an element header.
    broken.push(new Uint8Array(16));
    expect(broken.read()).toMatchObject({ kind: "webm", measured: false });
  });
});
