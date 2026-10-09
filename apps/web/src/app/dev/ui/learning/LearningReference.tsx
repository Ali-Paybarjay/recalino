"use client";

import { useEffect, useRef } from "react";
import { RecordingProvider } from "../../../../ui/recording/RecordingProvider";
import { AppShell, PageHeader } from "../../../../ui/shell/AppShell";
import {
  AutomaticLearningProvider,
  useAutomaticLearning,
} from "../../../../ui/workspace/AutomaticLearningProvider";
import {
  AutomaticLearningNotice,
  AutomaticLearningView,
} from "../../../../ui/workspace/AutomaticLearningView";
import type { AutomaticLearningStatus } from "../../../../ui/workspace/automatic-learning";
import { LinkButton, Panel } from "../../../../ui/workspace/primitives";

const sessionId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const initial: AutomaticLearningStatus = {
  state: "blocked",
  revision: 1,
  batchId: null,
  run: null,
  snapshot: null,
  lastError: "processing_failed",
  message:
    "Automatic creation could not finish. Your material and earlier notes and cards are saved. Check the material or retry this attempt.",
  notesReady: false,
  cardsReady: false,
};

function LearningFixture({ progress }: { progress: boolean }) {
  const { refresh } = useAutomaticLearning(sessionId);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    // The real provider polls /classes paths. This fixture uses its public refresh
    // on /dev instead, with an empty recording store and synthetic identities.
    const check = () => void refreshRef.current().catch(() => {});
    check();
    const timer = setInterval(check, 3000);
    return () => clearInterval(timer);
  }, []);
  return progress ? (
    <AutomaticLearningView sessionId={sessionId} initial={initial} />
  ) : (
    <Panel title="Session materials">
      <LinkButton href={`/sessions/${sessionId}/sources`}>Add material</LinkButton>
      <AutomaticLearningNotice sessionId={sessionId} />
    </Panel>
  );
}

export function LearningReference({ progress }: { progress: boolean }) {
  return (
    <RecordingProvider userId={userId}>
      <AutomaticLearningProvider>
        <div className="preview-root">
          <AppShell
            current="classes"
            hrefs={{
              today: "/dev/ui/learning",
              classes: "/dev/ui/learning",
              review: "/dev/ui/learning",
              me: "/dev/ui/learning",
            }}
          >
            <PageHeader
              title={progress ? "Session progress" : "Synthetic session"}
              subtitle="Automatic learning interface fixture · No real class data"
            />
            <LearningFixture progress={progress} />
          </AppShell>
        </div>
      </AutomaticLearningProvider>
    </RecordingProvider>
  );
}
