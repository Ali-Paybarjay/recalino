"use client";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { z } from "zod";
import { PREPARED_SAMPLE_MATERIAL, type SampleMaterialMetadata } from "./sample-material";

export type SampleCard = {
  id: string;
  classId: string;
  type: "qa" | "vocabulary" | "cloze" | "grammar" | "error" | "listening";
  question: string;
  answer: string;
  source: string;
  status: "suggested" | "active" | "rejected" | "suspended" | "known" | "deleted";
  important: boolean;
  tooHard: boolean;
};
export type SampleSource = {
  id: string;
  name: string;
  kind: "audio" | "pdf" | "photo";
  durationMinutes: number;
  pages: number;
  selected: boolean;
  role: string;
  status: string;
  rangeStart: number;
  rangeEnd: number;
};
export type PreviewState = {
  classes: {
    id: string;
    title: string;
    customTitle?: string | null;
    course: string;
    unit: string;
    date: string;
    status: string;
  }[];
  courses: { id: string; name: string; units: string[] }[];
  sources: SampleSource[];
  allowance: { minutes: number; pages: number };
  processing: string;
  processingSnapshot: SampleSource[];
  recording: { elapsed: number; photos: number; paused: boolean; active: boolean };
  classWorkspaces: Record<string, SampleWorkspace>;
  noteText: string;
  materialMetadata?: SampleMaterialMetadata | null;
  noteHistory: { id: string; text: string; label: string }[];
  transcript: string;
  cards: SampleCard[];
  selectedCardId: string | null;
  reviewEvents: {
    id: string;
    cardId: string;
    rating: "forgot" | "remembered" | "again" | "hard" | "good" | "easy";
    saved: boolean;
  }[];
  reviewCursor: number;
  reviewSessionIds: string[];
  reviewStartedAt: number | null;
  reviewSessionEventIds: string[];
  profile: {
    language: string;
    explanations: "english" | "bilingual" | "native";
    level: string;
    goal: string;
    timezone: string;
    consent: boolean;
  };
  preferences: { ratingMode: "simple" | "advanced"; newCards: boolean; shortExamples: boolean };
};
export type SampleWorkspace = {
  sources: SampleSource[];
  noteText: string;
  materialMetadata?: SampleMaterialMetadata | null;
  noteHistory: { id: string; text: string; label: string }[];
  transcript: string;
  processing: string;
  processingSnapshot: SampleSource[];
};
function workspace(state: PreviewState): SampleWorkspace {
  return {
    sources: state.sources,
    noteText: state.noteText,
    materialMetadata: state.materialMetadata,
    noteHistory: state.noteHistory,
    transcript: state.transcript,
    processing: state.processing,
    processingSnapshot: state.processingSnapshot,
  };
}
function emptyWorkspace(): SampleWorkspace {
  return {
    sources: [],
    noteText: "",
    materialMetadata: null,
    noteHistory: [],
    transcript: "",
    processing: "idle",
    processingSnapshot: [],
  };
}

export const PREVIEW_STORAGE_KEY = "recalino-ui-preview-v1";
export function createSampleState(): PreviewState {
  const noteText =
    "Use the present perfect for a past action connected to now.\n\nForm: have / has + past participle.\n\n“I have already finished my homework.”\n\nAlready means something happened earlier than expected.";
  const base = (
    id: string,
    type: SampleCard["type"],
    question: string,
    answer: string,
    status: SampleCard["status"] = "suggested",
  ): SampleCard => ({
    id,
    classId: "present-perfect",
    type,
    question,
    answer,
    status,
    source: "Audio 18:42 · Present perfect",
    important: false,
    tooHard: false,
  });
  return {
    classes: [
      {
        id: "present-perfect",
        title: "Present perfect",
        customTitle: null,
        course: "ESOL B1",
        unit: "Everyday English",
        date: "2026-10-02",
        status: "Ready",
      },
      {
        id: "travel",
        title: "Talking about travel",
        customTitle: "Talking about travel",
        course: "ESOL B1",
        unit: "Everyday English",
        date: "2026-09-30",
        status: "New",
      },
    ],
    courses: [
      { id: "esol", name: "ESOL B1", units: ["Everyday English"] },
      { id: "default", name: "My classes", units: [] },
    ],
    sources: [
      {
        id: "audio-1",
        name: "Class recording",
        kind: "audio",
        durationMinutes: 48,
        pages: 0,
        selected: true,
        role: "Class teaching",
        status: "Received",
        rangeStart: 0,
        rangeEnd: 48,
      },
      {
        id: "pdf-1",
        name: "Present perfect handout.pdf",
        kind: "pdf",
        durationMinutes: 0,
        pages: 4,
        selected: true,
        role: "Class material",
        status: "Received",
        rangeStart: 1,
        rangeEnd: 4,
      },
      {
        id: "photo-1",
        name: "Whiteboard photo",
        kind: "photo",
        durationMinutes: 0,
        pages: 1,
        selected: true,
        role: "Class material",
        status: "Received",
        rangeStart: 1,
        rangeEnd: 1,
      },
    ],
    allowance: { minutes: 60, pages: 20 },
    processing: "idle",
    processingSnapshot: [],
    recording: { elapsed: 756, photos: 0, paused: false, active: false },
    classWorkspaces: {},
    noteText,
    materialMetadata: PREPARED_SAMPLE_MATERIAL,
    noteHistory: [{ id: "original", text: noteText, label: "Original sample notes" }],
    transcript:
      "Teacher: We use already when something happened earlier than expected.\nLearner: I have already finished my homework.",
    cards: [
      base(
        "review-1",
        "qa",
        "What does already tell us?",
        "Something happened earlier than expected.",
        "active",
      ),
      base("review-2", "cloze", "I ___ already finished my homework.", "have", "active"),
      base(
        "review-3",
        "grammar",
        "What form does the present perfect use?",
        "have / has + past participle",
        "active",
      ),
      base(
        "review-4",
        "error",
        "Correct this sentence: She have finished.",
        "She has finished.",
        "active",
      ),
      base(
        "suggestion-1",
        "qa",
        "What is the present perfect form?",
        "have / has + past participle",
      ),
      base("suggestion-2", "cloze", "She ___ visited London.", "has"),
      base(
        "suggestion-3",
        "grammar",
        "What follows have / has in the present perfect?",
        "A past participle.",
      ),
      base(
        "suggestion-4",
        "error",
        "Correct this sentence: I has already left.",
        "I have already left.",
      ),
      base("suggestion-5", "vocabulary", "What does already mean?", "Earlier than expected."),
      base(
        "suggestion-6",
        "listening",
        "Listen and complete the sentence.",
        "I have already finished.",
      ),
    ],
    selectedCardId: null,
    reviewEvents: [],
    reviewCursor: 0,
    reviewSessionIds: [],
    reviewStartedAt: null,
    reviewSessionEventIds: [],
    profile: {
      language: "Persian",
      explanations: "english",
      level: "B1",
      goal: "Everyday English",
      timezone: "Europe/London",
      consent: false,
    },
    preferences: { ratingMode: "simple", newCards: true, shortExamples: true },
  };
}
type PreviewContextValue = {
  state: PreviewState;
  setState: Dispatch<SetStateAction<PreviewState>>;
  reset: () => void;
  announce: (message: string) => void;
  message: string;
};
const PreviewContext = createContext<PreviewContextValue | null>(null);
export function PreviewProvider({ children }: { children: ReactNode }) {
  const [state, setStoredState] = useState(createSampleState);
  const [ready, setReady] = useState(false);
  const [message, announce] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (validSample(saved)) setStoredState(saved);
      }
    } catch {
      announce("Sample storage is unavailable. Changes last for this visit only.");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(state));
    } catch {
      announce("Sample storage is unavailable. Changes last for this visit only.");
    }
  }, [state, ready]);
  const setState: Dispatch<SetStateAction<PreviewState>> = useCallback((action) => {
    setStoredState((previous) => {
      const next = typeof action === "function" ? action(previous) : action;
      const before = previous.classes[0]?.id;
      const after = next.classes[0]?.id;
      if (before === after) return next;
      const remaining = new Set(next.classes.map((lesson) => lesson.id));
      const classWorkspaces = Object.fromEntries(
        Object.entries(next.classWorkspaces).filter(([id]) => remaining.has(id)),
      );
      if (before && remaining.has(before)) classWorkspaces[before] = workspace(previous);
      const selected =
        after && Object.hasOwn(classWorkspaces, after) ? classWorkspaces[after] : emptyWorkspace();
      const cards = next.cards.filter((card) => remaining.has(card.classId));
      const cardIds = new Set(cards.map((card) => card.id));
      return {
        ...next,
        ...selected,
        classWorkspaces,
        cards,
        reviewEvents: next.reviewEvents.filter((event) => cardIds.has(event.cardId)),
        reviewSessionIds: next.reviewSessionIds.filter((id) => cardIds.has(id)),
      };
    });
  }, []);
  const reset = () => {
    setStoredState(createSampleState());
    announce("Sample workspace reset.");
  };
  return (
    <PreviewContext.Provider value={{ state, setState, reset, announce, message }}>
      {ready ? (
        children
      ) : (
        <main id="content" className="preview-focus" aria-busy="true">
          <p role="status">Opening your sample workspace…</p>
        </main>
      )}
    </PreviewContext.Provider>
  );
}
const text = z.string().max(20000);
const number = z.number().finite().nonnegative();
const materialMetadataSchema = z
  .object({ title: z.string().trim().min(1).max(200), topics: z.array(text).max(100) })
  .nullable()
  .optional();
const sourceSchema = z.object({
  id: text,
  name: text,
  kind: z.enum(["audio", "pdf", "photo"]),
  durationMinutes: number,
  pages: number,
  selected: z.boolean(),
  role: text,
  status: text,
  rangeStart: number,
  rangeEnd: number,
});
const workspaceSchema = z.object({
  sources: z.array(sourceSchema).max(1000),
  noteText: text,
  materialMetadata: materialMetadataSchema,
  noteHistory: z.array(z.object({ id: text, text, label: text })).max(1000),
  transcript: text,
  processing: text,
  processingSnapshot: z.array(sourceSchema).max(1000),
});
const sampleSchema = z.object({
  classes: z
    .array(
      z.object({
        id: text,
        title: text,
        customTitle: z.string().max(200).nullable().optional(),
        course: text,
        unit: text,
        date: text,
        status: text,
      }),
    )
    .max(1000),
  courses: z.array(z.object({ id: text, name: text, units: z.array(text).max(1000) })).max(1000),
  sources: z
    .array(
      z.object({
        id: text,
        name: text,
        kind: z.enum(["audio", "pdf", "photo"]),
        durationMinutes: number,
        pages: number,
        selected: z.boolean(),
        role: text,
        status: text,
        rangeStart: number,
        rangeEnd: number,
      }),
    )
    .max(1000),
  allowance: z.object({ minutes: number, pages: number }),
  processing: text,
  processingSnapshot: z.array(sourceSchema).max(1000),
  recording: z.object({
    elapsed: number,
    photos: number,
    paused: z.boolean(),
    active: z.boolean(),
  }),
  classWorkspaces: z.record(text, workspaceSchema),
  noteText: text,
  materialMetadata: materialMetadataSchema,
  noteHistory: z.array(z.object({ id: text, text, label: text })).max(1000),
  transcript: text,
  cards: z
    .array(
      z.object({
        id: text,
        classId: text,
        type: z.enum(["qa", "vocabulary", "cloze", "grammar", "error", "listening"]),
        question: text,
        answer: text,
        source: text,
        status: z.enum(["suggested", "active", "rejected", "suspended", "known", "deleted"]),
        important: z.boolean(),
        tooHard: z.boolean(),
      }),
    )
    .max(1000),
  selectedCardId: text.nullable(),
  reviewEvents: z
    .array(
      z.object({
        id: text,
        cardId: text,
        rating: z.enum(["forgot", "remembered", "again", "hard", "good", "easy"]),
        saved: z.boolean(),
      }),
    )
    .max(10000),
  reviewCursor: number,
  reviewSessionIds: z.array(text),
  reviewStartedAt: number.nullable(),
  reviewSessionEventIds: z.array(text),
  profile: z.object({
    language: text,
    explanations: z.enum(["english", "bilingual", "native"]),
    level: text,
    goal: text,
    timezone: text,
    consent: z.boolean(),
  }),
  preferences: z.object({
    ratingMode: z.enum(["simple", "advanced"]),
    newCards: z.boolean(),
    shortExamples: z.boolean(),
  }),
});
function validSample(value: unknown): value is PreviewState {
  return sampleSchema.safeParse(value).success;
}
export function usePreview() {
  const value = useContext(PreviewContext);
  if (!value) throw new Error("PreviewProvider is required");
  return value;
}
