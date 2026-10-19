import type { Goal, Level } from "@recalino/core/acc";
import { setupStrings as strings } from "../../ui/strings-setup";

// Labels of the level and goal choices (frame A2-4), shared by setup and Settings.

export const GOAL_LABELS: Record<Goal, string> = {
  esol: strings.setup.goalEsol,
  ielts: strings.setup.goalIelts,
  general: strings.setup.goalGeneral,
  none: strings.setup.goalNone,
};

export function levelLabel(level: Level): string {
  return level === "not_sure" ? strings.setup.notSure : level;
}
