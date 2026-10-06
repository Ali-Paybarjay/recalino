import type { SampleSource } from "./PreviewContext";

export function sourceHasDetails(source: SampleSource) {
  if (source.kind === "photo") return source.pages === 1;
  const total = source.kind === "audio" ? source.durationMinutes : source.pages;
  if (!Number.isFinite(total) || total <= 0 || (source.kind === "pdf" && !Number.isInteger(total)))
    return false;
  if (!sourceUsesPart(source)) return true;
  return (
    Number.isFinite(source.rangeStart) &&
    Number.isFinite(source.rangeEnd) &&
    (source.kind === "audio" ||
      (Number.isInteger(source.rangeStart) && Number.isInteger(source.rangeEnd))) &&
    source.rangeStart >= (source.kind === "audio" ? 0 : 1) &&
    source.rangeEnd <= total &&
    (source.kind === "audio"
      ? source.rangeEnd > source.rangeStart
      : source.rangeEnd >= source.rangeStart)
  );
}

export function sourceUsesPart(source: SampleSource) {
  return (
    source.kind !== "photo" &&
    (source.selectionMode === "part" ||
      (source.selectionMode === undefined &&
        (source.rangeStart !== (source.kind === "audio" ? 0 : 1) ||
          source.rangeEnd !== (source.kind === "audio" ? source.durationMinutes : source.pages))))
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
        .map((source) => [
          source.id,
          sourceUsesPart(source) ? { ...source } : withFullExtent(source),
        ]),
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

export function withFullExtent(source: SampleSource): SampleSource {
  return {
    ...source,
    selectionMode: "whole",
    rangeStart: source.kind === "audio" ? 0 : 1,
    rangeEnd: source.kind === "audio" ? source.durationMinutes : source.pages,
  };
}

export function withPreparedSampleDetails(source: SampleSource): SampleSource {
  return withFullExtent({
    ...source,
    durationMinutes: source.kind === "audio" ? 10 : 0,
    pages: source.kind === "audio" ? 0 : source.kind === "pdf" ? 4 : 1,
    role: source.kind === "audio" ? "Class teaching" : "Class material",
    status: source.status === "Needs password" ? "Needs password" : "Received",
    selected: true,
  });
}
