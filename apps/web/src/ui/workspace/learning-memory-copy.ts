import { pendingCopy } from "../pending-copy";

/**
 * D49 Your learning and Class Notes adaptation copy. Not in the design handoff; the product owner
 * approved the proposed texts on 2026-10-08 (docs/plans/TEACHING_MEMORY_2026-10-08.md §5).
 * Texts changed by the 2026-10-09 review fixes come from the pending-copy register instead.
 */
const pending = pendingCopy.learningMemory;
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

export const learningMemoryCopy = {
  nextTitle: "Your next step",
  nextPractiseDue: (label: string) => `Practise “${label}” in review now.`,
  nextPractiseCard: (label: string) => `Look at “${label}” again before it comes back in review.`,
  nextPractiseDueAction: "Practise it now",
  nextPractiseCardAction: "Open this card",
  nextReviewDue: (count: number) =>
    count === 1 ? "1 review is due." : `${count} reviews are due.`,
  nextReviewDueAction: "Open review",
  nextNothingDue: "Nothing is due right now.",
  nextDueAt: (date: string) => `Your next review is due on ${date}.`,
  nextNoCards: "Add a class to start your flashcards.",
  nextNoCardsAction: "Go to classes",
  noticedTitle: "What Recalino has noticed",
  noticedIntro:
    "Based only on your own Recall answers in the last 30 days. It describes that practice, not your level, speaking or exam readiness.",
  latestEvidence: (date: string) => `Latest answer considered: ${date}.`,
  noEvidence:
    "Not enough evidence yet. After a few reviews, this page shows what you recalled well and what may need more practice.",
  practiseTitle: "Suggested for more practice",
  practiseReason: (again: number, date: string, recalled: number) =>
    `You chose Again or Forgot ${again} times, most recently on ${date}.${
      recalled === 1 ? " You recalled it once since then." : ""
    }`,
  recalledTitle: pending.recalledTitle,
  recalledReason: (count: number, date: string) =>
    `You recalled it in your last ${count} answers, most recently on ${date}.`,
  fromClass: (date: string, course: string | null) =>
    course ? `From your class on ${date} · ${course}` : `From your class on ${date}`,
  evidence: (amount: "little" | "some" | "more", reviews: number, sets: string) =>
    `Evidence: ${amount} (${reviews === 1 ? "1 answer" : `${reviews} answers`}; ${sets}).`,
  setProduction: pending.setProduction,
  setRecognition: pending.setRecognition,
  setLegacy: pending.setLegacy,
  notDifficulty: "This isn't a difficulty for me",
  explainSimpler: "Explain it more simply next time",
  stopSimpler: "Stop the simpler explanation",
  dismissedTitle: "You said these aren't difficulties",
  dismissedReason: (date: string) =>
    `You said this on ${date}. A new Again or Forgot answer brings it back.`,
  showAgain: "Show it again",
  simplerTitle: "You asked for simpler explanations",
  simplerReason: (date: string) => fill(pending.simplerReason, { date }),
  definitions:
    "Evidence amounts: little = 1–2 answers, some = 3–5, more = 6 or more. “Suggested for more practice” means at least two Again or Forgot answers and fewer than two recalls since the latest one. Recalling a card is not the same as using the language on your own.",
  saved: "Your correction is saved.",
  failed: "Your correction could not be saved.",
  simplerLabel: "Use simpler explanations",
  simplerHint:
    "An explicit choice applies to classes processed from now on. Existing notes and cards stay as you saved them.",
  simplerStandard: "Standard explanations",
  simplerOn: "Simpler explanations",
  adaptationTitle: "Prepared for you",
  adaptationLevel: (level: string) => `Your chosen level: ${level}`,
  adaptationGoal: (goal: string) => `Your goal: ${goal}`,
  adaptationShorter: "Shorter examples (your choice)",
  adaptationSimpler: "Simpler explanations (your choice)",
  adaptationFocus: (target: string, reason: "recall_difficulty" | "asked_simpler", date: string) =>
    reason === "recall_difficulty"
      ? `“${target}” appears in this lesson. Before it was prepared, you chose Again or Forgot for it in review (latest ${date}).`
      : fill(pending.adaptationAskedSimpler, { target, date }),
  adaptationNote:
    "This lists what the lesson was prepared with. It is not a test result or a judgement of your English.",
} as const;
