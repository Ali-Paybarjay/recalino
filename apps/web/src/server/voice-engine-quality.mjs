/** Pure, conservative post-processing shared by the native worker and its tests. */
export function normalizeEmbedding(values) {
  const vector = Array.from(values);
  if (!vector.length || vector.some((value) => !Number.isFinite(value)))
    throw new Error("voice_embedding_invalid");
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm < 1e-8) throw new Error("voice_embedding_empty");
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(left, right) {
  if (left.length !== right.length) throw new Error("voice_embedding_dimension_mismatch");
  const a = normalizeEmbedding(left);
  const b = normalizeEmbedding(right);
  return Math.max(
    -1,
    Math.min(
      1,
      a.reduce((sum, value, index) => sum + value * b[index], 0),
    ),
  );
}

export function poolEmbeddings(entries) {
  if (!entries.length) throw new Error("voice_embedding_empty");
  const dimension = entries[0].embedding.length;
  const pooled = Array(dimension).fill(0);
  for (const entry of entries) {
    if (entry.embedding.length !== dimension || !Number.isFinite(entry.weight) || entry.weight <= 0)
      throw new Error("voice_embedding_pool_invalid");
    const embedding = normalizeEmbedding(entry.embedding);
    for (let index = 0; index < dimension; index++)
      pooled[index] += embedding[index] * entry.weight;
  }
  return normalizeEmbedding(pooled);
}

/** Any detected simultaneous speaker excludes the entire interval, including containment. */
export function qualifySegments(raw, durationMs, offsetMs = 0, boundaries = []) {
  durationMs = Math.floor(durationMs);
  const segments = raw
    .map((segment) => {
      if (
        !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) ||
        !Number.isSafeInteger(segment.speaker) ||
        segment.speaker < 0 ||
        segment.start < 0 ||
        segment.end <= segment.start ||
        segment.end * 1000 > durationMs + 100
      )
        throw new Error("voice_diarization_output_invalid");
      const start = Math.max(0, Math.round(segment.start * 1000));
      const end = Math.min(durationMs, Math.round(segment.end * 1000));
      return {
        speakerId: `speaker_${segment.speaker}`,
        startMs: start + offsetMs,
        endMs: end + offsetMs,
        overlap: false,
        // Edge-clipped or too short to keep two seconds after trimming both turn boundaries.
        boundaryUnsafe:
          start < 200 ||
          end > durationMs - 200 ||
          end - start < 2400 ||
          boundaries.some((boundary) => start < boundary + 200 && end > boundary - 200),
      };
    })
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (let index = 0; index < segments.length; index++) {
    const current = segments[index];
    for (let later = index + 1; later < segments.length; later++) {
      const next = segments[later];
      if (next.startMs >= current.endMs) break;
      if (next.speakerId !== current.speakerId) current.overlap = next.overlap = true;
    }
  }
  return segments;
}

/**
 * A bounded, distributed sample of only clean interior speech. `whole-turns` drops every turn
 * that touches another detected voice. `clean-parts` keeps the parts of such a turn that are at
 * least 200 ms away from any other voice. Edge-clipped, splice-adjacent and short turns are
 * always dropped, and turn flags for spoken-mistake evidence are unchanged.
 */
export function embeddingSpans(segments, speakerId, mode = "whole-turns") {
  const windows = [];
  for (const segment of segments) {
    if (segment.speakerId !== speakerId || segment.boundaryUnsafe) continue;
    if (segment.overlap && mode !== "clean-parts") continue;
    let parts = [{ startMs: segment.startMs + 200, endMs: segment.endMs - 200 }];
    if (segment.overlap)
      for (const other of segments) {
        if (other.speakerId === speakerId) continue;
        const cutStart = other.startMs - 200;
        const cutEnd = other.endMs + 200;
        parts = parts.flatMap((part) =>
          cutEnd <= part.startMs || cutStart >= part.endMs
            ? [part]
            : [
                { startMs: part.startMs, endMs: Math.min(part.endMs, cutStart) },
                { startMs: Math.max(part.startMs, cutEnd), endMs: part.endMs },
              ].filter((piece) => piece.endMs - piece.startMs >= 2000),
        );
      }
    for (const part of parts)
      for (let start = part.startMs; part.endMs - start >= 2000; start += 10000)
        windows.push({ startMs: start, endMs: Math.min(start + 10000, part.endMs) });
  }
  // Distribute sampling through the recording rather than trusting its first turn.
  const ordered = [];
  for (let index = 0, count = Math.min(24, windows.length); index < count; index++)
    ordered.push(windows[Math.floor((index * windows.length) / count)]);
  const maximumPerSpan = Math.floor(60000 / Math.max(1, ordered.length));
  return ordered.flatMap((span) => {
    const duration = Math.min(maximumPerSpan, span.endMs - span.startMs);
    if (duration < 2000) return [];
    return [{ startMs: span.startMs, endMs: span.startMs + duration }];
  });
}

/** Re-mark simultaneous speech after voices are relabelled; same-voice intersections are not overlap. */
export function markOverlaps(segments) {
  const ordered = segments
    .map((segment) => ({ ...segment, overlap: false }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (let index = 0; index < ordered.length; index++) {
    const current = ordered[index];
    for (let later = index + 1; later < ordered.length; later++) {
      const next = ordered[later];
      if (next.startMs >= current.endMs) break;
      if (next.speakerId !== current.speakerId) current.overlap = next.overlap = true;
    }
  }
  return ordered;
}

function simultaneousMs(segments, left, right) {
  let total = 0;
  for (const a of segments) {
    if (a.speakerId !== left) continue;
    for (const b of segments)
      if (b.speakerId === right)
        total += Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
  }
  return total;
}

/**
 * Over-split voices are merged when their pooled clean speech is alike. The native clustering
 * compares short chunks; pooled vectors over several clean seconds are steadier. Two voices
 * heard at the same time for a quarter of the shorter one's speech are never merged. Voices
 * with under `minSpeechMs` of clean speech keep their own label. `embedSpan` returns a
 * normalised vector for one span. Returns relabelled segments with overlap re-marked.
 */
export function mergeVoices(segments, embedSpan, threshold, minSpeechMs = 4000) {
  const speech = new Map();
  for (const segment of segments)
    speech.set(
      segment.speakerId,
      (speech.get(segment.speakerId) ?? 0) + segment.endMs - segment.startMs,
    );
  const voices = [];
  for (const speakerId of speech.keys()) {
    const spans = embeddingSpans(segments, speakerId, "clean-parts");
    const weight = spans.reduce((sum, span) => sum + span.endMs - span.startMs, 0);
    if (weight < minSpeechMs) continue;
    voices.push({
      ids: [speakerId],
      weight,
      vector: poolEmbeddings(
        spans.map((span) => ({ embedding: embedSpan(span), weight: span.endMs - span.startMs })),
      ),
    });
  }
  for (;;) {
    let best = null;
    for (let i = 0; i < voices.length; i++)
      for (let j = i + 1; j < voices.length; j++) {
        const similarity = cosineSimilarity(voices[i].vector, voices[j].vector);
        if (similarity < threshold || (best && similarity <= best.similarity)) continue;
        const left = voices[i].ids.reduce((sum, id) => sum + (speech.get(id) ?? 0), 0);
        const right = voices[j].ids.reduce((sum, id) => sum + (speech.get(id) ?? 0), 0);
        let together = 0;
        for (const a of voices[i].ids)
          for (const b of voices[j].ids) together += simultaneousMs(segments, a, b);
        if (together >= 0.25 * Math.min(left, right)) continue;
        best = { i, j, similarity };
      }
    if (!best) break;
    const [keep, drop] = [voices[best.i], voices[best.j]];
    keep.vector = poolEmbeddings([
      { embedding: keep.vector, weight: keep.weight },
      { embedding: drop.vector, weight: drop.weight },
    ]);
    keep.weight += drop.weight;
    keep.ids.push(...drop.ids);
    voices.splice(best.j, 1);
  }
  const label = new Map();
  for (const voice of voices) for (const id of voice.ids) label.set(id, voice.ids[0]);
  return markOverlaps(
    segments.map((segment) => ({
      ...segment,
      speakerId: label.get(segment.speakerId) ?? segment.speakerId,
    })),
  );
}

/**
 * Clean single turns for target-speaker scoring: a detected turn's parts at least 200 ms from any
 * other voice, away from the composite's edges and splices, at least `minMs` long. Unlike
 * voiceprint spans these keep short turns (1.5–2.4 s); each yields at most one 10-second span.
 */
export function targetTurnSpans(segments, durationMs, offsetMs = 0, boundaries = [], minMs = 1500) {
  const end = offsetMs + Math.floor(durationMs);
  const spans = [];
  for (const segment of segments) {
    if (
      segment.startMs < offsetMs + 200 ||
      segment.endMs > end - 200 ||
      boundaries.some(
        (boundary) =>
          segment.startMs < offsetMs + boundary + 200 && segment.endMs > offsetMs + boundary - 200,
      )
    )
      continue;
    let parts = [{ startMs: segment.startMs + 100, endMs: segment.endMs - 100 }];
    for (const other of segments) {
      if (other.speakerId === segment.speakerId) continue;
      const cutStart = other.startMs - 200;
      const cutEnd = other.endMs + 200;
      parts = parts.flatMap((part) =>
        cutEnd <= part.startMs || cutStart >= part.endMs
          ? [part]
          : [
              { startMs: part.startMs, endMs: Math.min(part.endMs, cutStart) },
              { startMs: Math.max(part.startMs, cutEnd), endMs: part.endMs },
            ].filter((piece) => piece.endMs > piece.startMs),
      );
    }
    const longest = parts.sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))[0];
    if (!longest || longest.endMs - longest.startMs < minMs) continue;
    spans.push({
      speakerId: segment.speakerId,
      startMs: longest.startMs,
      endMs: Math.min(longest.endMs, longest.startMs + 10000),
    });
  }
  return spans.slice(0, 2000);
}
