"use client";
import type { KnowledgeModel } from "@recalino/core/lkm";
import { renderClassNotesHtml } from "@recalino/core/study-render";
import { studyPronunciationTarget } from "@recalino/core/study-target";
import { useCallback, useMemo, useState } from "react";
import { ClassNotesFrame } from "./ClassNotesFrame";
import type { NotePronunciationPlayback } from "./class-notes-pronunciation";
import { PronunciationAudio, type PronunciationState } from "./PronunciationAudio";

export function ClassNotesPlayback({
  model,
  sessionId,
  revisionId,
}: {
  model: KnowledgeModel;
  sessionId: string;
  revisionId: string;
}) {
  const items = useMemo(
    () =>
      model.learningItems.flatMap((item) => {
        const target = studyPronunciationTarget(item);
        return target ? [{ id: item.id, target }] : [];
      }),
    [model],
  );
  const html = useMemo(() => renderClassNotesHtml(model, { itemAnchors: true }), [model]);
  const [selected, setSelected] = useState<{ id: string; target: string; trigger: number } | null>(
    null,
  );
  const [playback, setPlayback] = useState<NotePronunciationPlayback>();
  const select = useCallback(
    (id: string) => {
      const item = items.find((item) => item.id === id);
      if (!item) return;
      setSelected((old) => ({ ...item, trigger: (old?.trigger ?? 0) + 1 }));
    },
    [items],
  );
  const selectedId = selected?.id;
  const update = useCallback(
    (state: PronunciationState) => {
      if (selectedId) setPlayback({ itemId: selectedId, ...state });
    },
    [selectedId],
  );
  return (
    <>
      <ClassNotesFrame
        html={html}
        title={model.title}
        pronunciationItems={items}
        onPronunciation={select}
        playback={playback}
      />
      {selected && (
        <PronunciationAudio
          key={`${revisionId}:${selected.id}`}
          sessionId={sessionId}
          target={selected.target}
          request={{
            kind: "note_pronunciation",
            learningItemId: selected.id,
            expectedNotebookRevisionId: revisionId,
          }}
          trigger={selected.trigger}
          showButton={false}
          onState={update}
        />
      )}
    </>
  );
}
