import type { SampleSource } from "./PreviewContext";

export function sourceHasDetails(source: SampleSource) {
  if (!Number.isFinite(source.rangeStart) || !Number.isFinite(source.rangeEnd)) return false;
  if (source.kind === "photo") return source.pages === 1;
  const total = source.kind === "audio" ? source.durationMinutes : source.pages;
  return (
    Number.isFinite(total) &&
    total > 0 &&
    (source.kind === "audio" ||
      (Number.isInteger(total) &&
        Number.isInteger(source.rangeStart) &&
        Number.isInteger(source.rangeEnd))) &&
    source.rangeStart >= (source.kind === "audio" ? 0 : 1) &&
    source.rangeEnd <= total &&
    (source.kind === "audio"
      ? source.rangeEnd > source.rangeStart
      : source.rangeEnd >= source.rangeStart)
  );
}

export function sourceIsReady(source: SampleSource) {
  return source.status === "Received" && sourceHasDetails(source);
}

export function confirmedSources(sources: SampleSource[]) {
  return [
    ...new Map(
      sources
        .filter((source) => source.selected && sourceIsReady(source))
        .map((source) => [source.id, { ...source }]),
    ).values(),
  ];
}

export function selectedCost(sources: SampleSource[]) {
  return confirmedSources(sources).reduce(
    (sum, source) => ({
      minutes: sum.minutes + (source.kind === "audio" ? source.rangeEnd - source.rangeStart : 0),
      pages:
        sum.pages +
        (source.kind === "photo"
          ? 1
          : source.kind === "pdf"
            ? source.rangeEnd - source.rangeStart + 1
            : 0),
    }),
    { minutes: 0, pages: 0 },
  );
}

export function withSampleCount(source: SampleSource, count: number): SampleSource {
  const total = Number.isFinite(count)
    ? Math.max(0, Math.min(10000, source.kind === "pdf" ? Math.floor(count) : count))
    : 0;
  const minimum = source.kind === "audio" ? 0 : 1;
  const start =
    total > 0
      ? Math.min(
          Math.max(minimum, source.rangeStart),
          source.kind === "audio" ? Math.max(0, total - 0.01) : total,
        )
      : minimum;
  const end =
    total > 0
      ? Math.max(
          source.kind === "audio" ? start + 0.01 : start,
          Math.min(total, source.rangeEnd || total),
        )
      : 0;
  return {
    ...source,
    durationMinutes: source.kind === "audio" ? total : 0,
    pages: source.kind === "audio" ? 0 : total,
    rangeStart: start,
    rangeEnd: end,
    status: "Needs details",
    selected: false,
  };
}
