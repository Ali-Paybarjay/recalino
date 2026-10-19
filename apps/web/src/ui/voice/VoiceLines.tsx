"use client";
import type { VoiceAnalysisView } from "@recalino/core/voice-contracts";
import { Actions, Button } from "../workspace/primitives";
import styles from "./Voice.module.css";
import { voiceCopy } from "./voice-copy";

const copy = voiceCopy;

/** The learner marks one line of one part as theirs or not (D64), as sent to the voice route. */
export type VoiceLineAction = {
  scope: "line";
  analysisId: string;
  expectedVersion: number;
  utteranceId: string;
  choice: "mine" | "not_mine" | "clear";
};

function timestamp(ms: number) {
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
}

/**
 * Lines of one part that may be the learner's own short turns (target-speaker turns, D64), and
 * the lines already marked. Marking a line never verifies a whole voice. Renders nothing when the
 * part has no such line or the switch is off (the server then sends no `lines`).
 */
export function VoiceLines({
  analysis,
  disabled,
  onAction,
}: {
  analysis: VoiceAnalysisView;
  disabled: boolean;
  onAction: (payload: VoiceLineAction) => Promise<void> | void;
}) {
  const lines = analysis.lines ?? [];
  if (!lines.length) return null;
  const act = (utteranceId: string, choice: VoiceLineAction["choice"]) =>
    void onAction({
      scope: "line",
      analysisId: analysis.id,
      expectedVersion: analysis.version,
      utteranceId,
      choice,
    });
  return (
    <div className={styles.aside}>
      <strong>{copy.linesHeading}</strong>
      <p className="workspace-muted">{copy.linesIntro}</p>
      <ol className={styles.clips} aria-label={copy.linesHeading}>
        {lines.map((line) => (
          <li key={line.utteranceId} className={styles.clip}>
            <span className={styles.clipLabel}>
              {timestamp(line.startMs)}
              {line.choice === "mine"
                ? ` · ${copy.lineMarkedMine}`
                : line.choice === "not_mine"
                  ? ` · ${copy.lineMarkedNotMine}`
                  : ""}
            </span>
            <p dir="auto">{line.text}</p>
            <Actions>
              {line.choice ? (
                <Button
                  secondary
                  disabled={disabled}
                  onClick={() => act(line.utteranceId, "clear")}
                >
                  {copy.lineUndo}
                </Button>
              ) : (
                <>
                  <Button disabled={disabled} onClick={() => act(line.utteranceId, "mine")}>
                    {copy.lineMine}
                  </Button>
                  <Button
                    secondary
                    disabled={disabled}
                    onClick={() => act(line.utteranceId, "not_mine")}
                  >
                    {copy.lineNotMine}
                  </Button>
                </>
              )}
            </Actions>
          </li>
        ))}
      </ol>
    </div>
  );
}
