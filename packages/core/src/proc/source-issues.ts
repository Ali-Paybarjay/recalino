import type { Database, Tx } from "../db";
import { getVersion } from "../lkm";
import { getSession } from "../org";
import { canonicalJson, errors, type LearnerContext } from "../plt";
import { ownedSourceAvailability, sessionSources } from "../src";
import type { RunSource } from "./contracts";
import { readKnowledgeSourceSnapshot } from "./recovery";

export interface NoteSourceIssue {
  sourceId: string;
  name: string;
  order: number;
  kind: "upload" | "extraction" | "timing" | "empty" | "unavailable";
  message: string;
  details?: string;
  locator?: string;
  action: "retry" | "upload" | "review" | "none";
  recovery?: {
    sourceId: string;
    contentVersionId: string;
    knowledgeVersionId: string;
    expectedSourcesVersion: number;
  };
}

export interface NoteMaterialSource {
  sourceId: string;
  name: string;
  order: number;
  status: "ready" | "uploading" | "needs-upload" | "local-audio";
}

function selectedUnits(source: RunSource) {
  return source.units.filter(
    (unit) =>
      !source.ranges.length ||
      source.ranges.some((range) =>
        unit.kind === "page"
          ? unit.start >= range.start && unit.start <= range.end
          : unit.kind === "time"
            ? unit.start >= range.start && (unit.end ?? unit.start) <= range.end
            : true,
      ),
  );
}

function timeLabel(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Only immutable, selected extraction units supply affected page/time labels. */
export function describeSourceIssues(
  source: RunSource,
  context: {
    name: string;
    order: number;
    originalAvailable: boolean;
    currentSelection: boolean;
    knowledgeVersionId: string;
    sourcesVersion: number;
  },
): NoteSourceIssue[] {
  const units = selectedUnits(source);
  const failed = units.filter((unit) => unit.status !== "extracted");
  const groups = new Map<string, typeof units>();
  for (const unit of failed) {
    const reason = unit.reason ?? "unreadable";
    groups.set(reason, [...(groups.get(reason) ?? []), unit]);
  }
  if (!groups.size) groups.set("details_unavailable", []);
  return Array.from(groups, ([reason, affected]) => {
    const pages = affected.filter((unit) => unit.kind === "page").map((unit) => unit.start);
    const times = affected.filter((unit) => unit.kind === "time");
    const locator = pages.length
      ? `${pages.length === 1 ? "Page" : "Pages"} ${pages.join(", ")}`
      : times.length
        ? times
            .map((unit) => `${timeLabel(unit.start)}–${timeLabel(unit.end ?? unit.start)}`)
            .join(", ")
        : undefined;
    const base = { sourceId: source.sourceId, name: context.name, order: context.order, locator };
    if (reason === "timestamps_unavailable")
      return {
        ...base,
        kind: "timing" as const,
        message: "Transcript available; timestamps unavailable.",
        details:
          "The available transcript is included in these notes. Citations for this part cannot link to an exact moment in the recording.",
        action: "none" as const,
      };
    if (reason === "no_speech")
      return {
        ...base,
        kind: "empty" as const,
        message: "No speech was detected in this part.",
        details:
          "Review the recording before uploading it again. Silent material can be excluded from the selected sources.",
        action: "review" as const,
      };
    if (reason === "no_text")
      return {
        ...base,
        kind: "empty" as const,
        message: "No readable text was found.",
        details:
          "Check whether this material is blank or needs a clearer copy. Re-uploading the same bytes may not help.",
        action: "review" as const,
      };
    const canRetry =
      reason !== "details_unavailable" &&
      context.originalAvailable &&
      context.currentSelection &&
      source.contentVersionId !== null &&
      ["image", "pdf", "audio"].includes(source.kind);
    return {
      ...base,
      kind: reason === "details_unavailable" ? ("unavailable" as const) : ("extraction" as const),
      message:
        reason === "details_unavailable"
          ? "Processing details for this version are unavailable."
          : `${locator ?? "Selected content"} could not be read completely.`,
      details: canRetry
        ? "Retry extraction from this file. Your saved notes stay available; review the updated preview before applying it."
        : !context.currentSelection
          ? "Class material has changed since these notes were made. Review the current sources to prepare an updated version."
          : source.kind === "audio"
            ? "Use the device holding the original recording to recover this part. These notes and the available transcript remain saved."
            : "Choose a clearer copy of this file in class material. The original may no longer be available for processing.",
      action: canRetry
        ? ("retry" as const)
        : context.currentSelection && !context.originalAvailable && source.kind !== "audio"
          ? ("upload" as const)
          : ("review" as const),
      ...(canRetry && source.contentVersionId
        ? {
            recovery: {
              sourceId: source.sourceId,
              contentVersionId: source.contentVersionId,
              knowledgeVersionId: context.knowledgeVersionId,
              expectedSourcesVersion: context.sourcesVersion,
            },
          }
        : {}),
    };
  });
}

/** Version-specific diagnostics never substitute the latest extraction for a saved note's pin. */
export async function getNoteSourceStatus(
  db: Database | Tx,
  ctx: LearnerContext,
  sessionId: string,
  knowledgeVersionId?: string,
): Promise<{ issues: NoteSourceIssue[]; materials: NoteMaterialSource[] }> {
  const session = await getSession(db, ctx, sessionId);
  const links = await sessionSources(db, ctx, sessionId);
  const selected = links.filter((link) => link.selected);
  const materials: NoteMaterialSource[] = selected.map((link, index) => ({
    sourceId: link.assetId,
    name: link.displayName,
    order: index + 1,
    status:
      link.verifiedAt || link.contentVersionId
        ? "ready"
        : link.kind === "audio"
          ? "local-audio"
          : link.uploadState === "verifying"
            ? "uploading"
            : "needs-upload",
  }));
  if (!knowledgeVersionId)
    return {
      materials,
      issues: materials
        .filter((material) => material.status === "needs-upload")
        .map((material) => ({
          ...material,
          kind: "upload",
          message: "Upload has not been completed and verified.",
          details:
            "Choose this same file again to resume its upload. Confirmed uploaded parts are kept.",
          action: "upload",
        })),
    };
  const knowledge = await getVersion(db, ctx, knowledgeVersionId);
  if (knowledge.sessionId !== sessionId) throw errors.notFound();
  const missing = knowledge.model.coverage.missingSourceIds;
  if (!missing.length) return { issues: [], materials };
  const { sources } = await readKnowledgeSourceSnapshot(db, ctx, knowledgeVersionId);
  const assets = await ownedSourceAvailability(db, ctx, missing);
  const issues = missing.flatMap((sourceId) => {
    const source = sources.find((candidate) => candidate.sourceId === sourceId);
    const asset = assets.find((candidate) => candidate.sourceId === sourceId);
    const order =
      Math.max(
        0,
        sources.findIndex((candidate) => candidate.sourceId === sourceId),
      ) + 1;
    const name = asset?.displayName ?? `Unavailable file ${order}`;
    if (!source || !asset)
      return [
        {
          sourceId,
          name,
          order,
          kind: "unavailable" as const,
          message: "Source details for this saved version are unavailable.",
          action: "review" as const,
        },
      ];
    const current = selected.find((link) => link.assetId === sourceId);
    return describeSourceIssues(source, {
      name,
      order,
      originalAvailable: asset.originalAvailable,
      currentSelection:
        current?.contentVersionId === source.contentVersionId &&
        canonicalJson(current.ranges) === canonicalJson(source.ranges),
      knowledgeVersionId,
      sourcesVersion: session.sourcesVersion,
    });
  });
  return { issues, materials };
}
