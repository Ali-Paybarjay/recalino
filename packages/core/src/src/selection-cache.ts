export interface SourceRange {
  start: number;
  end: number;
}

/** Audio needs fresh boundary cuts whenever its requested extent changes. */
export function audioSelectionMatchesCache(
  requested: readonly SourceRange[],
  extracted: readonly SourceRange[],
): boolean {
  return (
    requested.length === extracted.length &&
    requested.every(
      (range, index) =>
        range.start === extracted[index]?.start && range.end === extracted[index]?.end,
    )
  );
}

export function extractionSettings(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
