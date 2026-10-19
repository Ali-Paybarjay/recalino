"use client";
import type { SourceRef } from "@recalino/core/lkm";
import { useEffect, useRef, useState } from "react";
import { IndexedRecordingStore } from "../recording/store";
import { userMessage, workspaceRequest } from "./api";
import { Actions, Button, Status } from "./primitives";

interface ContentVersion {
  id: string;
  blocks: { id: string; text: string; unitId: string }[];
  units: { id: string; kind: string; start: number; end?: number; status: string }[];
}
/** SourceRef uses a pinned immutable extraction; audio is played only from this account's device. */
export function SourceRefViewer({ reference, userId }: { reference: SourceRef; userId: string }) {
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [problem, setProblem] = useState(""),
    [text, setText] = useState(""),
    [media, setMedia] = useState<string | null>(null),
    [kind, setKind] = useState(""),
    [name, setName] = useState("");
  const audio = useRef<HTMLAudioElement>(null),
    localUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    },
    [],
  );
  const locator = reference.locator;
  const label =
    locator.kind === "time"
      ? `Audio ${Math.floor(locator.startMs / 60000)}:${String(Math.floor(locator.startMs / 1000) % 60).padStart(2, "0")}`
      : locator.kind === "page"
        ? `Source page ${locator.page}`
        : "Source text";
  async function show() {
    if (open) {
      audio.current?.pause();
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    setProblem("");
    try {
      const versions = await workspaceRequest<ContentVersion[]>(
          `/api/sources/${reference.sourceId}/content`,
          "GET",
        ),
        version = versions.find((item) => item.id === reference.contentVersionId);
      if (!version) throw new Error("The referenced extraction is no longer available.");
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
      setText(
        locator.kind === "text"
          ? (blocks[0]?.text.slice(locator.start, locator.end) ?? "")
          : blocks.map((block) => block.text).join("\n\n"),
      );
      const source = await workspaceRequest<{
        kind: string;
        display_name: string;
        original_deleted_at: string | null;
      }>(`/api/sources/${reference.sourceId}`, "GET");
      setKind(source.kind);
      setName(source.display_name);
      if (locator.kind === "time") {
        const store = new IndexedRecordingStore(),
          rows = await store.list(userId),
          recording = rows.find((row) => (row.sourceAssetId ?? row.id) === reference.sourceId);
        if (!recording) {
          setMedia(null);
          setProblem(
            "Original audio is not on this device. The saved transcript is available above.",
          );
          return;
        }
        if (localUrl.current) URL.revokeObjectURL(localUrl.current);
        const url = URL.createObjectURL(await store.blob(userId, recording.id));
        localUrl.current = url;
        setMedia(url);
      } else if (source.original_deleted_at) {
        setMedia(null);
        setProblem("The original file is no longer kept. This saved extraction remains available.");
      } else {
        const link = await workspaceRequest<{ url: string }>(
          `/api/sources/${reference.sourceId}/read`,
          "GET",
        );
        setMedia(link.url);
      }
    } catch (error) {
      setProblem(userMessage(error, "The source could not be opened."));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="preview-stack">
      <Button secondary disabled={loading} onClick={() => void show()} aria-expanded={open}>
        {label}
      </Button>
      {open ? (
        <div className="preview-panel">
          <strong dir="auto">{name || "Session material"}</strong>
          {loading ? <Status>Opening source…</Status> : null}
          {text ? (
            <p dir="auto" style={{ whiteSpace: "pre-wrap" }}>
              {text}
            </p>
          ) : null}
          {problem ? <Status>{problem}</Status> : null}
          {media && locator.kind === "time" ? (
            <>
              {/* biome-ignore lint/a11y/useMediaCaption: The immutable transcript is displayed directly above this audio-only player. */}
              <audio
                ref={audio}
                controls
                preload="metadata"
                src={media}
                onLoadedMetadata={() => {
                  if (audio.current) audio.current.currentTime = locator.startMs / 1000;
                }}
                onTimeUpdate={() => {
                  if (audio.current && audio.current.currentTime >= locator.endMs / 1000)
                    audio.current.pause();
                }}
              />
              <p className="preview-muted">
                Plays the original saved on this device. Speaker attribution follows the
                transcript’s confidence.
              </p>
            </>
          ) : media ? (
            <Actions>
              <a
                className="btn btn-secondary rc-btn-lg"
                href={
                  kind === "pdf" && locator.kind === "page"
                    ? `${media}#page=${locator.page}`
                    : media
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                {kind === "pdf"
                  ? "Open original PDF page"
                  : kind === "image"
                    ? "Open original image"
                    : "Open original file"}
              </a>
            </Actions>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
