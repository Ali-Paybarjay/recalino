import type { SourceRef } from "@recalino/core/lkm";

export interface ContentVersion {
  id: string;
  blocks: { id: string; text: string; unitId: string }[];
  units: { id: string; kind: string; start: number; end?: number; status: string }[];
}

/**
 * The pinned extraction text a SourceRef points to. Text locator offsets count Unicode code
 * points, as the LKM validator does, so emoji and other non-BMP characters are never split.
 */
export function sourceRefText(version: ContentVersion, locator: SourceRef["locator"]) {
  const blocks =
    locator.kind === "text"
      ? version.blocks.filter((block) => block.id === locator.blockId)
      : locator.kind === "page"
        ? version.blocks.filter((block) =>
            version.units.some(
              (unit) =>
                unit.id === block.unitId && unit.kind === "page" && unit.start === locator.page,
            ),
          )
        : version.blocks.filter((block) =>
            version.units.some(
              (unit) =>
                unit.id === block.unitId &&
                unit.kind === "time" &&
                unit.start < locator.endMs &&
                (unit.end ?? unit.start) > locator.startMs,
            ),
          );
  return locator.kind === "text"
    ? Array.from(blocks[0]?.text ?? "")
        .slice(locator.start, locator.end)
        .join("")
    : blocks.map((block) => block.text).join("\n\n");
}
