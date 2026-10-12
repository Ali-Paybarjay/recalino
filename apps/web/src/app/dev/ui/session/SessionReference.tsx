"use client";

import { RecordingProvider } from "../../../../ui/recording/RecordingProvider";
import { AppShell, PageHeader } from "../../../../ui/shell/AppShell";
import { AutomaticLearningProvider } from "../../../../ui/workspace/AutomaticLearningProvider";
import type { AutomaticLearningStatus } from "../../../../ui/workspace/automatic-learning";
import { SessionNextStep, VoiceStepCard } from "../../../../ui/workspace/SessionNextStep";
import { UploadProvider } from "../../../../ui/workspace/UploadProvider";

const userId = "10000000-0000-4000-8000-000000000002";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const run = (state: string, lastError: string | null = null) =>
  ({
    id: id(90),
    sessionId: id(1),
    state,
    reservationId: id(91),
    sourcesVersion: 1,
    lastError,
    outputVersionId: null,
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T10:00:00.000Z",
  }) as AutomaticLearningStatus["run"];
const status = (patch: Partial<AutomaticLearningStatus>): AutomaticLearningStatus => ({
  state: "idle",
  revision: 1,
  batchId: null,
  run: null,
  snapshot: null,
  lastError: null,
  message: "",
  notesReady: false,
  cardsReady: false,
  ...patch,
});

/** Synthetic states only; no class data. One card per resolver outcome. */
export const sessionStates: {
  name: string;
  status: AutomaticLearningStatus | null;
  notes?: boolean;
  cards?: boolean;
  voice?: boolean;
}[] = [
  { name: "empty", status: status({}) },
  { name: "processing", status: status({ state: "processing", run: run("processing") }) },
  {
    name: "ready-voice",
    status: status({ state: "ready", run: run("ready"), notesReady: true, cardsReady: true }),
    notes: true,
    cards: true,
    voice: true,
  },
  {
    name: "allowance-short",
    status: status({
      state: "blocked",
      lastError: "quota_insufficient",
      message:
        "Your material is saved, but this class needs more allowance than is left. You do not need to upload the same files again.",
      allowance: {
        active: true,
        required: { audio: 7_680_000, document: 0, regeneration: 0 },
        available: { audio: 4_160_000, document: 0, regeneration: 0 },
      } as unknown as AutomaticLearningStatus["allowance"],
    }),
  },
  {
    name: "audio-not-received",
    status: status({
      state: "blocked",
      lastError: "audio_upload_rejected",
      run: run("needs_input", "audio_upload_rejected"),
      message: "The audio could not be verified.",
    }),
  },
];

export function SessionReference() {
  return (
    <RecordingProvider userId={userId}>
      <AutomaticLearningProvider>
        <UploadProvider>
          <div className="preview-root">
            <AppShell
              current="classes"
              hrefs={{
                today: "/dev/ui/session",
                classes: "/dev/ui/session",
                review: "/dev/ui/session",
                me: "/dev/ui/session",
              }}
            >
              <PageHeader
                title="Synthetic session"
                subtitle="Session next step fixture · No real class data"
              />
              <div className="preview-stack">
                {sessionStates.map((state, index) => (
                  <div key={state.name} data-state={state.name} className="preview-stack">
                    <SessionNextStep
                      sessionId={id(index + 1)}
                      initial={state.status}
                      content={{ notes: !!state.notes, cards: !!state.cards }}
                      voicePending={!!state.voice}
                      studyShownBelow={!!state.voice}
                    />
                    {state.voice ? <VoiceStepCard sessionId={id(index + 1)} /> : null}
                  </div>
                ))}
              </div>
            </AppShell>
          </div>
        </UploadProvider>
      </AutomaticLearningProvider>
    </RecordingProvider>
  );
}
