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

/** A bounded, distributed sample of only clean interior speech; no overlaps or turn boundaries. */
export function embeddingSpans(segments, speakerId) {
  const windows = [];
  for (const segment of segments) {
    if (segment.speakerId !== speakerId || segment.overlap || segment.boundaryUnsafe) continue;
    const end = segment.endMs - 200;
    for (let start = segment.startMs + 200; end - start >= 2000; start += 10000)
      windows.push({ startMs: start, endMs: Math.min(start + 10000, end) });
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
