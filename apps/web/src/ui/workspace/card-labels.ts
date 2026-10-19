import type { MediaAsset } from "@recalino/core/media";
import { statusStrings } from "../strings-status";
import { learningMemoryCopy } from "./learning-memory-copy";

/**
 * Words for what a card is, never the stored value (UX-05). Each label reuses a word the design
 * already shows: the card-type names of the frames and /preview ("Vocabulary", "Cloze", "Grammar
 * point", "Error correction", "Listening", "Question and answer"), "Suggested" (frame E3 list)
 * and the state words of the card actions ("Suspended", "Known", "Rejected").
 */
const TEMPLATE_LABELS: Record<string, string> = {
  basic: "Question and answer",
  vocabulary: "Vocabulary",
  cloze: "Cloze",
  grammar: "Grammar point",
  correction: "Error correction",
  listening: "Listening",
};

/** A card that is simply in the learner's review has no state word. */
const STATUS_LABELS: Record<string, string> = {
  candidate: "Suggested",
  suspended: "Suspended",
  known: "Known",
  rejected: "Rejected",
};

/** The name of a card type, or null for a type the design has no word for. */
export function cardTemplateLabel(template: string): string | null {
  return TEMPLATE_LABELS[template] ?? null;
}

/** The state of a card in words, or null when it needs none. */
export function cardStatusLabel(status: string): string | null {
  return STATUS_LABELS[status] ?? null;
}

/** "Suggested · Question and answer · Important": what a card is, in the order a learner asks. */
export function cardSummary(card: {
  status: string;
  template: string;
  important?: boolean;
}): string {
  return [
    cardStatusLabel(card.status),
    cardTemplateLabel(card.template),
    card.important ? "Important" : null,
  ]
    .filter((part): part is string => !!part)
    .join(" · ");
}

/** A study set's name: the approved words of Your learning, with a capital letter to start a label. */
export function studySetLabel(set: "production" | "recognition" | "legacy"): string {
  const words =
    set === "production"
      ? learningMemoryCopy.setProduction
      : set === "recognition"
        ? learningMemoryCopy.setRecognition
        : learningMemoryCopy.setLegacy;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The state of a card's media in the words of the session status ("Ready", "In queue", …). */
export function mediaStateLabel(state: MediaAsset["state"]): string {
  const words = statusStrings.classStatus;
  return {
    queued: words.inQueue,
    processing: words.processing,
    ready: words.ready,
    failed: words.failed,
    needs_input: words.needsAction,
    deleted: words.cancelled,
  }[state];
}

/** "Computer voice 1 · Ready": a media choice by what it is, not by its stored id and state. */
export function mediaAssetLabel(asset: Pick<MediaAsset, "synthetic" | "state">, index: number) {
  const what = asset.synthetic ? statusStrings.provenance.computerVoice : "Class image";
  return `${what} ${index + 1} · ${mediaStateLabel(asset.state)}`;
}
