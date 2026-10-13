import { describe, expect, it } from "vitest";
import { CaptureMeter } from "./capture-meter";
import type { MediaTimeline, TimelineReading } from "./media-timeline";

/** Each pushed chunk holds the number of audio milliseconds written in it. */
class FakeTimeline implements MediaTimeline {
  reading: TimelineReading = { kind: "webm", measured: true, mediaMs: 0, jumpMs: 0 };
  push(bytes: Uint8Array) {
    this.reading = {
      ...this.reading,
      mediaMs: this.reading.mediaMs + Number(new TextDecoder().decode(bytes)),
    };
  }
  read() {
    return this.reading;
  }
}
function meter(measured = true) {
  let now = Date.UTC(2026, 9, 12, 8, 49);
  const timeline = new FakeTimeline();
  timeline.reading.measured = measured;
  const value = new CaptureMeter(() => now, timeline);
  const chunk = (audioMs: number) => value.push(new TextEncoder().encode(String(audioMs)), now);
  return {
    meter: value,
    chunk,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("capture meter (PRD-REC-03, PRD-REC-05)", () => {
  it("finds no gap while chunks hold the audio of their interval", () => {
    const test = meter();
    test.meter.run();
    for (let i = 0; i < 120; i++) {
      test.advance(5000);
      expect(test.chunk(5000)).toBeNull();
    }
    expect(test.meter.mediaMs()).toBe(600000);
    expect(test.meter.gaps).toEqual([]);
  });

  it("reports a frozen page by its missing audio, not by device time", () => {
    const test = meter();
    test.meter.run();
    test.advance(5000);
    test.chunk(5000);
    test.meter.note("frozen");
    test.advance(28 * 60 * 1000);
    const gap = test.chunk(5000);
    expect(gap).toMatchObject({
      from: "2026-10-12T08:49:05.000Z",
      to: "2026-10-12T09:17:05.000Z",
      offsetMs: 5000,
      missingMs: 28 * 60 * 1000 - 5000,
      cause: "frozen",
    });
    expect(test.meter.mediaMs()).toBe(10000);
    expect(test.meter.wallMs()).toBe(28 * 60 * 1000 + 5000);
  });

  it("withdraws a gap when the delayed chunk's audio arrives in the next one", () => {
    const test = meter();
    test.meter.run();
    test.advance(5000);
    test.chunk(5000);
    // The page was hidden and one dataavailable event came 4 s late with only its own audio.
    test.meter.note("hidden", true);
    test.advance(9000);
    expect(test.chunk(5000)).toMatchObject({ missingMs: 4000, cause: "hidden" });
    test.advance(1000);
    expect(test.chunk(5000)).toBeNull();
    expect(test.meter.gaps).toEqual([]);
  });

  it("never turns slow clock drift over a long class into a gap", () => {
    const test = meter();
    test.meter.run();
    // 0.1% drift, four times what audio hardware usually shows, for two hours.
    for (let i = 0; i < 1440; i++) {
      test.advance(5005);
      test.chunk(5000);
    }
    expect(test.meter.gaps).toEqual([]);
  });

  it("does not count paused time as missing audio", () => {
    const test = meter();
    test.meter.run();
    test.advance(5000);
    test.chunk(5000);
    test.meter.halt();
    test.advance(10 * 60 * 1000);
    test.meter.run();
    test.advance(5000);
    expect(test.chunk(5000)).toBeNull();
    expect(test.meter.wallMs()).toBe(10000);
  });

  it("keeps the live counter from running ahead of missing audio", () => {
    const test = meter();
    test.meter.run();
    test.advance(5000);
    test.chunk(5000);
    test.advance(60000);
    expect(test.meter.liveMs()).toBe(11000);
  });

  it("uses the device clock when the container cannot be read, without claiming gaps", () => {
    const test = meter(false);
    test.meter.run();
    test.advance(60000);
    expect(test.chunk(1000)).toBeNull();
    expect(test.meter.mediaMs()).toBe(60000);
    expect(test.meter.measured).toBe(false);
  });

  it("measures the final interval when the part is sealed", () => {
    const test = meter();
    test.meter.run();
    test.advance(5000);
    test.chunk(5000);
    test.meter.note("muted");
    test.advance(20000);
    test.meter.halt();
    test.chunk(2000);
    expect(test.meter.seal()).toBeNull();
    expect(test.meter.gaps).toEqual([
      expect.objectContaining({ missingMs: 18000, cause: "muted" }),
    ]);
    expect(test.meter.missingMs()).toBe(18000);
  });
});
