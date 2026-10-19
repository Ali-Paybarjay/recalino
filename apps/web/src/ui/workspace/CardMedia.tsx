"use client";
import type { StudyCard } from "@recalino/core/card";
import type { MediaAsset } from "@recalino/core/media";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestKey, userMessage, workspaceRequest } from "./api";
import { mediaAssetLabel } from "./card-labels";
import { mediaAlt } from "./media-alt";
import { Actions, Button, Field, Panel, Status } from "./primitives";
import type { SourceRow } from "./SourcesView";
export function CardMedia({ card, onCard }: { card: StudyCard; onCard(card: StudyCard): void }) {
  const sessionId = card.sessionIds[0];
  const [assets, setAssets] = useState<MediaAsset[]>([]),
    [ttsConfigured, setTtsConfigured] = useState(false),
    [sources, setSources] = useState<SourceRow[]>([]),
    [selected, setSelected] = useState(""),
    [side, setSide] = useState<"front" | "back">("front"),
    [listening, setListening] = useState(card.template === "listening"),
    [text, setText] = useState(card.contentFormat === "lesson_html" ? "" : card.front),
    [sourceId, setSourceId] = useState(""),
    [crop, setCrop] = useState(false),
    [bounds, setBounds] = useState({ left: 0, top: 0, width: 200, height: 200 }),
    [exportAllowed, setExportAllowed] = useState(false),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState<{ url: string; mime: string; alt: string } | null>(null);
  const key = useRef<{ payload: string; key: string } | null>(null);
  const load = useCallback(async () => {
    if (!sessionId) return;
    const value = await workspaceRequest<{ media: MediaAsset[]; ttsConfigured: boolean }>(
      `/api/classes/${sessionId}/media`,
      "GET",
    );
    setAssets(value.media);
    setTtsConfigured(value.ttsConfigured);
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    void Promise.all([
      workspaceRequest<{ media: MediaAsset[]; ttsConfigured: boolean }>(
        `/api/classes/${sessionId}/media`,
        "GET",
      ),
      workspaceRequest<SourceRow[]>(`/api/classes/${sessionId}/sources`, "GET"),
    ])
      .then(([media, rows]) => {
        if (active) {
          setAssets(media.media);
          setTtsConfigured(media.ttsConfigured);
          setSources(
            rows.filter((row) => row.kind === "image" && row.verifiedAt && !row.originalDeletedAt),
          );
        }
      })
      .catch(() => {
        if (active) setProblem("Card media could not be loaded. Text remains available.");
      });
    return () => {
      active = false;
    };
  }, [sessionId]);
  useEffect(() => {
    if (!assets.some((asset) => asset.state === "queued" || asset.state === "processing")) return;
    const timer = setTimeout(() => {
      void load().catch(() =>
        setProblem("Could not update media status. Refresh media to try again."),
      );
    }, 4000);
    return () => clearTimeout(timer);
  }, [assets, load]);
  async function create(body: unknown) {
    if (!sessionId) return;
    setBusy(true);
    setProblem("");
    try {
      const asset = await workspaceRequest<MediaAsset>(
        `/api/classes/${sessionId}/media`,
        "POST",
        body,
        requestKey(key, body),
      );
      setAssets((items) => [asset, ...items.filter((item) => item.id !== asset.id)]);
      setSelected(asset.id);
      key.current = null;
      setNotice(
        asset.state === "ready"
          ? "Media is ready. Choose a card side and attach it."
          : "Media requested. It will appear when processing finishes.",
      );
    } catch (failure) {
      setProblem(userMessage(failure, "Media could not be requested."));
    } finally {
      setBusy(false);
    }
  }
  async function attach(mediaId: string | null) {
    setBusy(true);
    setProblem("");
    const body = {
      expectedVersion: card.contentVersion,
      side,
      mediaId,
      listening: side === "front" ? listening : undefined,
    };
    try {
      onCard(
        await workspaceRequest<StudyCard>(
          `/api/cards/${card.id}/media`,
          "POST",
          body,
          requestKey(key, body),
        ),
      );
      key.current = null;
      setNotice("Card media saved.");
    } catch (failure) {
      setProblem(userMessage(failure, "Media could not be attached."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Images and listening audio">
      {problem && <Status tone="error">{problem}</Status>}
      {notice && <Status>{notice}</Status>}
      <Field label="Card side">
        <select value={side} onChange={(event) => setSide(event.target.value as "front" | "back")}>
          <option value="front">Question side</option>
          <option value="back">Answer side</option>
        </select>
      </Field>
      {side === "front" && (
        <Field label="Question style">
          <select
            value={listening ? "listening" : "text"}
            onChange={(event) => setListening(event.target.value === "listening")}
          >
            <option value="text">Show question text</option>
            <option value="listening">Listening: play synthetic audio</option>
          </select>
        </Field>
      )}
      <Field label="Ready media">
        <select
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setPreview(null);
          }}
        >
          <option value="">Choose media</option>
          {assets.map((asset, index) => (
            <option key={asset.id} value={asset.id} disabled={asset.state !== "ready"}>
              {mediaAssetLabel(asset, index)}
            </option>
          ))}
        </select>
      </Field>
      <Actions>
        <Button
          disabled={
            busy || !assets.some((asset) => asset.id === selected && asset.state === "ready")
          }
          onClick={() => attach(selected)}
        >
          Attach media
        </Button>
        <Button
          secondary
          disabled={busy || !(side === "front" ? card.frontMediaId : card.backMediaId)}
          onClick={() => attach(null)}
        >
          Remove attachment
        </Button>
        <Button
          secondary
          disabled={busy}
          onClick={() => void load().catch(() => setProblem("Media could not be refreshed."))}
        >
          Refresh media
        </Button>
        {selected && (
          <Button
            secondary
            disabled={busy}
            onClick={async () => {
              try {
                const asset = assets.find((item) => item.id === selected);
                const value = await workspaceRequest<{ url: string }>(
                  `/api/media/${selected}/read`,
                  "GET",
                );
                // A11Y-05: the image is named by its source file, then by the card text on this side.
                const source = sources.find((item) => item.assetId === asset?.sourceId);
                setPreview({
                  url: value.url,
                  mime: asset?.mimeType ?? "",
                  alt: mediaAlt(source?.displayName, side === "front" ? card.front : card.back),
                });
              } catch {
                setProblem("The media preview is unavailable.");
              }
            }}
          >
            Preview media
          </Button>
        )}
      </Actions>
      {preview &&
        (preview.mime.startsWith("audio/") ? (
          <audio controls src={preview.url}>
            <track kind="captions" />
            Audio playback is unavailable.
          </audio>
        ) : (
          // biome-ignore lint/performance/noImgElement: Signed private URLs must not pass through an image proxy.
          <img
            src={preview.url}
            alt={preview.alt}
            dir="auto"
            style={{ maxWidth: "100%", height: "auto" }}
          />
        ))}
      {selected && assets.some((asset) => asset.id === selected) && (
        <Field
          label="Allow this media in downloads"
          hint="Only enable this when you have the rights to include it in exported notes and cards."
        >
          <select
            value={assets.find((asset) => asset.id === selected)?.exportAllowed ? "yes" : "no"}
            disabled={busy}
            onChange={async (event) => {
              setBusy(true);
              setProblem("");
              try {
                const value = await workspaceRequest<MediaAsset>(
                  `/api/media/${selected}`,
                  "PATCH",
                  { exportAllowed: event.target.value === "yes" },
                );
                setAssets((items) => items.map((item) => (item.id === value.id ? value : item)));
              } catch (failure) {
                setProblem(userMessage(failure, "Export permission could not be saved."));
              } finally {
                setBusy(false);
              }
            }}
          >
            <option value="no">Keep private in this app</option>
            <option value="yes">Allow in downloads</option>
          </select>
        </Field>
      )}
      <details>
        <summary
          style={{ minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer" }}
        >
          Create listening audio or a class image
        </summary>
        <p>
          Synthetic audio uses the configured voice. It is not a recording of your teacher. A
          request may use your processing allowance.
        </p>
        <Field label="Rights for new media">
          <select
            value={exportAllowed ? "yes" : "no"}
            onChange={(event) => setExportAllowed(event.target.value === "yes")}
          >
            <option value="no">Keep in the app</option>
            <option value="yes">I have rights to include this media in downloads</option>
          </select>
        </Field>
        <Field label="Short English text for synthetic audio">
          <textarea
            dir="auto"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={500}
            rows={3}
          />
        </Field>
        <Button
          disabled={busy || !text.trim() || !ttsConfigured}
          onClick={() => create({ kind: "tts", text: text.trim(), exportAllowed })}
        >
          Create synthetic audio
        </Button>
        {!ttsConfigured && (
          <Status>
            Speech generation is awaiting operator configuration. Saved media and card text remain
            available.
          </Status>
        )}
        <Field label="Class image source">
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            <option value="">Choose a verified image</option>
            {sources.map((source) => (
              <option key={source.assetId} value={source.assetId}>
                {source.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Image area">
          <select
            value={crop ? "crop" : "whole"}
            onChange={(event) => setCrop(event.target.value === "crop")}
          >
            <option value="whole">Use whole image</option>
            <option value="crop">Choose pixel bounds</option>
          </select>
        </Field>
        {crop && (
          <div className="preview-grid">
            {(["left", "top", "width", "height"] as const).map((part) => (
              <Field key={part} label={`${part[0]?.toUpperCase()}${part.slice(1)} (pixels)`}>
                <input
                  type="number"
                  min={part === "left" || part === "top" ? 0 : 1}
                  value={bounds[part]}
                  onChange={(event) => setBounds({ ...bounds, [part]: Number(event.target.value) })}
                />
              </Field>
            ))}
          </div>
        )}
        <Button
          secondary
          disabled={busy || !sourceId}
          onClick={() =>
            create({ kind: "image", sourceId, exportAllowed, ...(crop ? { crop: bounds } : {}) })
          }
        >
          Create card image
        </Button>
      </details>
    </Panel>
  );
}
