/**
 * Measures how much audio a recorder actually produced from the container's own timestamps
 * (PRD-REC-05). Recorder chunks are pushed in order; only headers and timestamps are read, and
 * no audio is decoded, kept or sent anywhere. WebM (Chromium, Firefox) and fragmented MP4
 * (Safari) are understood; any other container, or a stream that stops parsing, reports
 * `measured: false` so the caller can fall back to its clock.
 */
export type TimelineKind = "webm" | "mp4" | "unknown";
export type TimelineReading = {
  kind: TimelineKind;
  /** Whether `mediaMs` comes from the container's timestamps. */
  measured: boolean;
  /** Sum of encoded audio frames: what a decoder will play. */
  mediaMs: number;
  /** Timestamp discontinuities the recorder wrote between frames. */
  jumpMs: number;
};
export interface MediaTimeline {
  push(bytes: Uint8Array): void;
  read(): TimelineReading;
}

/** Opus packets are at most 120 ms; a longer step between frames is a discontinuity. */
const MAX_FRAME_MS = 120;
const DEFAULT_FRAME_MS = 20;
/** Only element headers, small values and boxes we read are buffered, never audio payload. */
const MAX_BUFFER = 1 << 20;

function concat(left: Uint8Array, right: Uint8Array) {
  if (!left.length) return right;
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}

/** Shared frame accounting from successive presentation timestamps in milliseconds. */
class FrameClock {
  private last: number | null = null;
  private frameMs = DEFAULT_FRAME_MS;
  private sum = 0;
  private jumps = 0;
  private frames = 0;
  /** A frame starting at `at`, with its own duration when the container states it. */
  frame(at: number, duration?: number) {
    if (this.last !== null) {
      const step = at - this.last;
      if (step > 0 && step <= MAX_FRAME_MS) {
        this.frameMs = step;
        this.sum += step;
      } else if (step > MAX_FRAME_MS) {
        this.sum += this.frameMs;
        this.jumps += step - this.frameMs;
      }
      // A non-increasing step is a reordered or duplicate frame and adds nothing.
    }
    if (duration !== undefined && duration > 0 && duration <= MAX_FRAME_MS) this.frameMs = duration;
    if (this.last === null || at > this.last) this.last = at;
    this.frames++;
  }
  get mediaMs() {
    return this.frames ? this.sum + this.frameMs : 0;
  }
  get jumpMs() {
    return this.jumps;
  }
}

const EBML = 0x1a45dfa3;
// Masters whose children we read; their (often unknown) size is ignored.
const ENTER = new Set([
  0x18538067 /* Segment */, 0x1549a966 /* Info */, 0x1f43b675 /* Cluster */, 0xa0 /* BlockGroup */,
]);
const SIMPLE_BLOCK = 0xa3;
const BLOCK = 0xa1;
const CLUSTER_TIMECODE = 0xe7;
const TIMECODE_SCALE = 0x2ad7b1;

function vintLength(first: number, max: number) {
  for (let length = 1; length <= max; length++) if (first & (0x80 >> (length - 1))) return length;
  return 0;
}

class WebmTimeline {
  private pending = new Uint8Array(0);
  private skip = 0;
  private clusterTime = 0;
  private scale = 1_000_000;
  private clock = new FrameClock();
  failed = false;
  push(chunk: Uint8Array) {
    if (this.failed) return;
    let bytes = chunk;
    if (this.skip) {
      const dropped = Math.min(this.skip, bytes.length);
      this.skip -= dropped;
      bytes = bytes.subarray(dropped);
      if (this.skip) return;
    }
    const data = concat(this.pending, bytes);
    let at = 0;
    while (at < data.length) {
      const first = data[at] ?? 0;
      const idLength = vintLength(first, 4);
      if (!idLength) return this.fail();
      if (at + idLength >= data.length) break;
      let id = 0;
      for (let i = 0; i < idLength; i++) id = id * 256 + (data[at + i] ?? 0);
      const sizeAt = at + idLength;
      const sizeLength = vintLength(data[sizeAt] ?? 0, 8);
      if (!sizeLength) return this.fail();
      if (sizeAt + sizeLength > data.length) break;
      let size = (data[sizeAt] ?? 0) & (0xff >> sizeLength);
      let unknown = size === 0xff >> sizeLength;
      for (let i = 1; i < sizeLength; i++) {
        const byte = data[sizeAt + i] ?? 0;
        unknown &&= byte === 0xff;
        size = size * 256 + byte;
      }
      const body = sizeAt + sizeLength;
      if (ENTER.has(id)) {
        at = body;
        continue;
      }
      if (unknown || !Number.isSafeInteger(size)) return this.fail();
      if (id === SIMPLE_BLOCK || id === BLOCK) {
        if (body >= data.length) break;
        const trackLength = vintLength(data[body] ?? 0, 8);
        if (!trackLength || size < trackLength + 3) return this.fail();
        if (body + trackLength + 2 > data.length) break;
        const raw = ((data[body + trackLength] ?? 0) << 8) | (data[body + trackLength + 1] ?? 0);
        const relative = raw & 0x8000 ? raw - 0x10000 : raw;
        this.clock.frame(((this.clusterTime + relative) * this.scale) / 1_000_000);
      } else if (id === CLUSTER_TIMECODE || id === TIMECODE_SCALE) {
        if (size > 8) return this.fail();
        if (body + size > data.length) break;
        let value = 0;
        for (let i = 0; i < size; i++) value = value * 256 + (data[body + i] ?? 0);
        if (id === CLUSTER_TIMECODE) this.clusterTime = value;
        else if (value > 0) this.scale = value;
      }
      const end = body + size;
      if (end > data.length) {
        this.skip = end - data.length;
        at = data.length;
        break;
      }
      at = end;
    }
    this.pending = data.slice(at);
    if (this.pending.length > MAX_BUFFER) this.fail();
  }
  private fail() {
    this.failed = true;
    this.pending = new Uint8Array(0);
  }
  read(): TimelineReading {
    return {
      kind: "webm",
      measured: !this.failed,
      mediaMs: this.clock.mediaMs,
      jumpMs: this.clock.jumpMs,
    };
  }
}

function u32(data: Uint8Array, at: number) {
  return (
    (data[at] ?? 0) * 0x1000000 +
    (((data[at + 1] ?? 0) << 16) | ((data[at + 2] ?? 0) << 8) | (data[at + 3] ?? 0))
  );
}
function u64(data: Uint8Array, at: number) {
  return u32(data, at) * 0x100000000 + u32(data, at + 4);
}
function* boxes(data: Uint8Array, from: number, to: number) {
  let at = from;
  while (at + 8 <= to) {
    let size = u32(data, at);
    const type = String.fromCharCode(...data.subarray(at + 4, at + 8));
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) return;
      size = u64(data, at + 8);
      header = 16;
    } else if (size === 0) size = to - at;
    if (size < header || at + size > to) return;
    yield { type, body: at + header, end: at + size };
    at += size;
  }
}
function child(data: Uint8Array, from: number, to: number, path: string[]) {
  let range: { body: number; end: number } | null = { body: from, end: to };
  for (const type of path) {
    if (!range) return null;
    const { body, end }: { body: number; end: number } = range;
    range = null;
    for (const box of boxes(data, body, end))
      if (box.type === type) {
        range = box;
        break;
      }
  }
  return range;
}

class Mp4Timeline {
  private pending = new Uint8Array(0);
  private skip = 0;
  private timescale = 0;
  private trexDuration = 0;
  private next: number | null = null;
  private clock = new FrameClock();
  failed = false;
  push(chunk: Uint8Array) {
    if (this.failed) return;
    let bytes = chunk;
    if (this.skip) {
      const dropped = Math.min(this.skip, bytes.length);
      this.skip -= dropped;
      bytes = bytes.subarray(dropped);
      if (this.skip) return;
    }
    const data = concat(this.pending, bytes);
    let at = 0;
    while (at + 8 <= data.length) {
      let size = u32(data, at);
      const type = String.fromCharCode(...data.subarray(at + 4, at + 8));
      if (size === 1) {
        if (at + 16 > data.length) break;
        size = u64(data, at + 8);
      } else if (size === 0) return this.fail();
      if (size < 8 || !Number.isSafeInteger(size)) return this.fail();
      if (type === "moov" || type === "moof") {
        if (size > MAX_BUFFER) return this.fail();
        if (at + size > data.length) break;
        if (type === "moov") this.readMovie(data, at + 8, at + size);
        else this.readFragment(data, at + 8, at + size);
        if (this.failed) return;
      } else if (at + size > data.length) {
        this.skip = at + size - data.length;
        at = data.length;
        break;
      }
      at += size;
    }
    this.pending = data.slice(at);
    if (this.pending.length > MAX_BUFFER) this.fail();
  }
  private readMovie(data: Uint8Array, from: number, to: number) {
    const mdhd = child(data, from, to, ["trak", "mdia", "mdhd"]);
    if (!mdhd) return this.fail();
    this.timescale = u32(data, mdhd.body + ((data[mdhd.body] ?? 0) === 1 ? 20 : 12));
    const trex = child(data, from, to, ["mvex", "trex"]);
    if (trex) this.trexDuration = u32(data, trex.body + 12);
    if (!this.timescale) this.fail();
  }
  private readFragment(data: Uint8Array, from: number, to: number) {
    if (!this.timescale) return this.fail();
    for (const traf of boxes(data, from, to)) {
      if (traf.type !== "traf") continue;
      let duration = this.trexDuration;
      let decode: number | null = null;
      const runs: { body: number; end: number }[] = [];
      for (const box of boxes(data, traf.body, traf.end)) {
        const flags = u32(data, box.body) & 0xffffff;
        if (box.type === "tfhd") {
          let at = box.body + 8;
          if (flags & 0x1) at += 8;
          if (flags & 0x2) at += 4;
          if (flags & 0x8) duration = u32(data, at);
        } else if (box.type === "tfdt")
          decode = (data[box.body] ?? 0) === 1 ? u64(data, box.body + 4) : u32(data, box.body + 4);
        else if (box.type === "trun") runs.push(box);
      }
      let time = decode ?? this.next ?? 0;
      for (const run of runs) {
        const flags = u32(data, run.body) & 0xffffff;
        const count = u32(data, run.body + 4);
        let at = run.body + 8;
        if (flags & 0x1) at += 4;
        if (flags & 0x4) at += 4;
        const stride =
          (flags & 0x100 ? 4 : 0) +
          (flags & 0x200 ? 4 : 0) +
          (flags & 0x400 ? 4 : 0) +
          (flags & 0x800 ? 4 : 0);
        if (at + count * stride > run.end) return this.fail();
        for (let i = 0; i < count; i++) {
          const sample = flags & 0x100 ? u32(data, at) : duration;
          if (!sample) return this.fail();
          this.clock.frame((time * 1000) / this.timescale, (sample * 1000) / this.timescale);
          time += sample;
          at += stride;
        }
      }
      this.next = time;
    }
  }
  private fail() {
    this.failed = true;
    this.pending = new Uint8Array(0);
  }
  read(): TimelineReading {
    return {
      kind: "mp4",
      measured: !this.failed && this.timescale > 0,
      mediaMs: this.clock.mediaMs,
      jumpMs: this.clock.jumpMs,
    };
  }
}

/** Chooses the parser from the first bytes of a recorder run. */
export class RecorderTimeline implements MediaTimeline {
  private parser: WebmTimeline | Mp4Timeline | null = null;
  private head = new Uint8Array(0);
  private unknown = false;
  push(bytes: Uint8Array) {
    if (this.unknown || !bytes.length) return;
    if (!this.parser) {
      const head = concat(this.head, bytes);
      if (head.length < 8) {
        this.head = head.slice();
        return;
      }
      this.head = new Uint8Array(0);
      if (u32(head, 0) === EBML) this.parser = new WebmTimeline();
      else if (String.fromCharCode(...head.subarray(4, 8)) === "ftyp")
        this.parser = new Mp4Timeline();
      else {
        this.unknown = true;
        return;
      }
      bytes = head;
    }
    this.parser.push(bytes);
  }
  read(): TimelineReading {
    if (!this.parser) return { kind: "unknown", measured: false, mediaMs: 0, jumpMs: 0 };
    return this.parser.read();
  }
}
