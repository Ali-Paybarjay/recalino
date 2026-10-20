"use client";
import type { Dimension } from "@recalino/core/quota";
import { useRef, useState } from "react";
import { allowanceCopy } from "../allowance-copy";
import { allowanceLabels, allowanceUnits } from "../allowance-units";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { FilePdf, FileText, Image as ImageIcon, ShieldCheck, Waveform } from "../icons";
import { useAutomaticLearning } from "./AutomaticLearningProvider";
import { requestKey, userMessage, workspaceRequest } from "./api";
import { type AutomaticLearningStatus, notifyAutomaticLearning } from "./automatic-learning";
import type { ProcessingEstimate } from "./ProcessingView";
import styles from "./ProcessSession.module.css";
import { Button as PanelButton, Status } from "./primitives";
import { processSessionCopy as copy } from "./process-session-copy";
import { sourceKindLabel } from "./source-labels";

// Existing texts: the old manual confirmation (ProcessingView) and the request default (api.ts).
const ESTIMATE_FAILED =
  "The processing estimate could not be loaded. Your saved material is still available. Try again.";
const NOT_SAVED = "The change could not be saved. Try again.";
const NOT_CONFIGURED = "AI is awaiting operator configuration. Your material remains saved.";
const MORE_ALLOWANCE = "More allowance is needed. Recording and review remain available.";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Frame C5's summary rows from the estimate's selected material: session audio as length and
 * parts, then photos and files. Lengths use the allowance units, as the lines below them do.
 */
export function processSummaryRows(estimate: Pick<ProcessingEstimate, "snapshot">) {
  const sources = estimate.snapshot.sources;
  const audio = sources.filter((source) => source.kind === "audio");
  const seconds = Math.round(
    audio.reduce(
      (sum, source) =>
        sum +
        (source.ranges.length
          ? source.ranges.reduce((total, range) => total + (range.end - range.start), 0)
          : (source.durationMs ?? 0)),
      0,
    ) / 1000,
  );
  const boardPhotos = sources.filter(
    (source) => source.kind === "image" && source.role === "board_photo",
  ).length;
  const photos = sources.filter(
    (source) => source.kind === "image" && source.role !== "board_photo",
  ).length;
  const pdfs = sources.filter((source) => source.kind === "pdf");
  const pages = pdfs.reduce((sum, source) => sum + (source.pageCount ?? 0), 0);
  const rows: { key: string; icon: typeof Waveform; label: string; value: string }[] = [];
  if (audio.length)
    rows.push({
      key: "audio",
      icon: Waveform,
      label: allowanceLabels.audio,
      value:
        audio.length > 1
          ? `${allowanceUnits("audio", seconds)} · ${audio.length} parts`
          : allowanceUnits("audio", seconds),
    });
  if (pdfs.length)
    rows.push({
      key: "pdf",
      icon: FilePdf,
      label: sourceKindLabel("pdf"),
      value: count(pages, "page", "pages"),
    });
  if (boardPhotos)
    rows.push({
      key: "board",
      icon: ImageIcon,
      label: "Board photos",
      value: count(boardPhotos, "photo", "photos"),
    });
  if (photos)
    rows.push({
      key: "image",
      icon: ImageIcon,
      label: sourceKindLabel("image"),
      value: count(photos, "photo", "photos"),
    });
  for (const kind of ["html", "text"] as const) {
    const files = sources.filter((source) => source.kind === kind).length;
    if (files)
      rows.push({ key: kind, icon: FileText, label: sourceKindLabel(kind), value: String(files) });
  }
  return rows;
}

const CHARGED: Dimension[] = ["audio", "document", "regeneration"];

/** What publishing would use of each allowance, next to what is left (D59 charge-once amounts). */
export function processAllowanceLines(
  estimate: Pick<ProcessingEstimate, "requested" | "allowance">,
) {
  const requested = estimate.requested;
  if (!requested) return [];
  return CHARGED.filter((dimension) => requested[dimension] > 0).map((dimension) =>
    allowanceCopy.shortageItem
      .replace("{allowance}", allowanceLabels[dimension])
      .replace("{needed}", allowanceUnits(dimension, requested[dimension]))
      .replace("{left}", allowanceUnits(dimension, estimate.allowance.remaining[dimension] ?? 0)),
  );
}

/** Whether the allowance left covers what publishing would use. */
export function processAllowanceCovers(
  estimate: Pick<ProcessingEstimate, "requested" | "allowance">,
) {
  const requested = estimate.requested;
  return (
    !!requested &&
    CHARGED.every(
      (dimension) => requested[dimension] <= (estimate.allowance.remaining[dimension] ?? 0),
    )
  );
}

/** The sheet's body (frame C5): the session's material, then the allowance it would use. */
export function ProcessSessionSummary({ estimate }: { estimate: ProcessingEstimate }) {
  const lines = processAllowanceLines(estimate);
  return (
    <>
      <ul className={styles.rows}>
        {processSummaryRows(estimate).map((row) => (
          <li key={row.key} className={row.key === "audio" ? styles.audio : undefined}>
            <Icon icon={row.icon} size={20} />
            <span>{row.label}</span>
            <span className={styles.value}>{row.value}</span>
          </li>
        ))}
      </ul>
      {lines.length ? (
        <ul className={styles.allowance}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {(estimate.requested?.regeneration ?? 0) > 0 ? <p>{copy.reopenedDetail}</p> : null}
      {!estimate.providerConfigured ? (
        <Status>{NOT_CONFIGURED}</Status>
      ) : !processAllowanceCovers(estimate) ? (
        <Status>{MORE_ALLOWANCE}</Status>
      ) : null}
    </>
  );
}

type Loaded = { revision: number; estimate: ProcessingEstimate | null; problem: string | null };

/**
 * "Process this session" (D105, D107): the only way lesson work starts. The button opens frame
 * C5's sheet with the session's material and allowance; nothing is sent until "Confirm and
 * process". The revision the sheet was built on goes with the request, so material that arrives
 * after the learner looked (another part, another device) is refused, never processed unseen.
 * A press that repeats one already made has no second effect (idempotency key, D105).
 */
export function ProcessSession({
  sessionId,
  secondary = false,
  disabled = false,
  onProblem,
  onProcessed,
}: {
  sessionId: string;
  secondary?: boolean;
  /** Material of this session is still on its way from this device, or a recording is open. */
  disabled?: boolean;
  /** Where a refusal is shown after the sheet closes; the button shows it itself otherwise. */
  onProblem?: (message: string) => void;
  onProcessed?: (status: AutomaticLearningStatus) => void;
}) {
  const live = useAutomaticLearning(sessionId);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const key = useRef<{ payload: string; key: string } | null>(null);
  const lock = useRef(false);
  const opened = useRef(0);
  function report(message: string) {
    if (onProblem) onProblem(message);
    else setProblem(message);
  }
  async function openSheet() {
    const attempt = ++opened.current;
    report("");
    setLoaded(null);
    setOpen(true);
    try {
      // The revision first: material that arrives while the estimate is read makes it stale, so
      // the server refuses the press instead of processing what the learner did not see.
      const status = await workspaceRequest<AutomaticLearningStatus>(
        `/api/classes/${sessionId}/learning`,
        "GET",
      );
      live.acceptStatus(status);
      let next: Loaded;
      try {
        const estimate = await workspaceRequest<ProcessingEstimate>(
          `/api/classes/${sessionId}/estimate`,
          "GET",
        );
        next = { revision: status.revision, estimate, problem: null };
      } catch (failure) {
        next = {
          revision: status.revision,
          estimate: null,
          problem: userMessage(failure, ESTIMATE_FAILED),
        };
      }
      if (attempt === opened.current) setLoaded(next);
    } catch (failure) {
      if (attempt !== opened.current) return;
      setOpen(false);
      report(userMessage(failure, ESTIMATE_FAILED));
    }
  }
  async function confirm() {
    if (!loaded || lock.current) return;
    lock.current = true;
    setBusy(true);
    const body = { action: "process", revision: loaded.revision };
    try {
      const status = await workspaceRequest<AutomaticLearningStatus>(
        `/api/classes/${sessionId}/learning`,
        "POST",
        body,
        requestKey(key, body),
      );
      key.current = null;
      live.acceptStatus(status);
      notifyAutomaticLearning(sessionId);
      setOpen(false);
      onProcessed?.(status);
    } catch (failure) {
      // The refusal is read after the sheet, where the next step is (D105: a recording still
      // open, an upload group still open, or material that changed after the summary).
      setOpen(false);
      report(userMessage(failure, NOT_SAVED));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const estimate = loaded?.estimate ?? null;
  const ready =
    !!estimate && estimate.providerConfigured && processAllowanceCovers(estimate) && !busy;
  return (
    <>
      <PanelButton
        secondary={secondary}
        disabled={disabled || busy}
        onClick={() => void openSheet()}
      >
        {copy.action}
      </PanelButton>
      {problem && !onProblem ? <Status tone="error">{problem}</Status> : null}
      <Sheet
        open={open}
        onClose={() => {
          opened.current++;
          setOpen(false);
        }}
        title={copy.title}
        footer={
          <>
            <Button
              variant="primary"
              size="lg"
              block
              loading={!loaded || busy}
              disabled={!!loaded && !busy && !ready}
              onClick={() => void confirm()}
            >
              {copy.confirm}
            </Button>
            <Button
              size="lg"
              block
              onClick={() => {
                opened.current++;
                setOpen(false);
              }}
            >
              {copy.notNow}
            </Button>
          </>
        }
      >
        {estimate ? (
          <ProcessSessionSummary estimate={estimate} />
        ) : loaded?.problem ? (
          <Status tone="error">{loaded.problem}</Status>
        ) : null}
        <p className={styles.promise}>
          <Icon icon={ShieldCheck} size={20} />
          <span>{copy.nothingYet}</span>
        </p>
      </Sheet>
    </>
  );
}
