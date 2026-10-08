import type { LessonAdaptationView } from "@recalino/core/proc";
import { strings } from "../strings";
import { memoryDate } from "./LearningMemory";
import { learningMemoryCopy as copy } from "./learning-memory-copy";
import styles from "./NoteView.module.css";

const GOALS: Record<NonNullable<LessonAdaptationView["goal"]>, string> = {
  esol: strings.setup.goalEsol,
  ielts: strings.setup.goalIelts,
  general: strings.setup.goalGeneral,
  none: strings.setup.goalNone,
};

/** D48: server-recorded inputs of this lesson version; never a model-written claim. */
export function LessonAdaptation({ adaptation }: { adaptation: LessonAdaptationView }) {
  const lines = [
    adaptation.declaredLevel
      ? copy.adaptationLevel(
          adaptation.declaredLevel === "not_sure"
            ? strings.setup.notSure
            : adaptation.declaredLevel,
        )
      : null,
    adaptation.goal && adaptation.goal !== "none"
      ? copy.adaptationGoal(GOALS[adaptation.goal])
      : null,
    adaptation.shorterExamples ? copy.adaptationShorter : null,
    adaptation.simplerExplanations ? copy.adaptationSimpler : null,
    ...adaptation.focus.map((focus) =>
      copy.adaptationFocus(
        focus.target,
        focus.reason,
        memoryDate(`${focus.lastEvidenceDate}T12:00:00Z`, "UTC"),
      ),
    ),
  ].filter((line): line is string => line !== null);
  if (!lines.length) return null;
  return (
    <details className={styles.evidence}>
      <summary>{copy.adaptationTitle}</summary>
      <div className={styles.evidenceBody}>
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="preview-muted">{copy.adaptationNote}</p>
      </div>
    </details>
  );
}
