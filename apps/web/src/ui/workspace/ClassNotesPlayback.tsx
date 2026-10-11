"use client";
import type { KnowledgeModel } from "@recalino/core/lkm";
import { renderClassNotesHtml } from "@recalino/core/study-render";
import { studyPronunciationTarget } from "@recalino/core/study-target";
import { useCallback, useMemo, useState } from "react";
import { ClassNotesFrame } from "./ClassNotesFrame";
import styles from "./ClassNotesPlayback.module.css";
import type { NotePronunciationPlayback } from "./class-notes-pronunciation";
import { PronunciationAudio, type PronunciationState } from "./PronunciationAudio";
import { Button } from "./primitives";
import { PronunciationCache } from "./pronunciation-cache";

export function ClassNotesPlayback({
  model,
  sessionId,
  revisionId,
  fitContent = false,
}: {
  model: KnowledgeModel;
  sessionId: string;
  revisionId: string;
  fitContent?: boolean;
}) {
  const pronunciationCache = useMemo(
    () => new PronunciationCache(`${sessionId}:${revisionId}`),
    [sessionId, revisionId],
  );
  const items = useMemo(
    () =>
      model.learningItems.flatMap((item) => {
        const target = studyPronunciationTarget(item);
        return target ? [{ id: item.id, target }] : [];
      }),
    [model],
  );
  const html = useMemo(() => renderClassNotesHtml(model, { itemAnchors: true }), [model]);
  const [selection, setSelected] = useState<{
    sessionId: string;
    revisionId: string;
    id: string;
    target: string;
    trigger: number;
  } | null>(null);
  const selected =
    selection?.sessionId === sessionId && selection.revisionId === revisionId ? selection : null;
  const [playback, setPlayback] = useState<{
    sessionId: string;
    revisionId: string;
    state: NotePronunciationPlayback;
  }>();
  const select = useCallback(
    (id: string) => {
      const item = items.find((item) => item.id === id);
      if (!item) return;
      setSelected((old) => ({
        ...item,
        sessionId,
        revisionId,
        trigger: (old?.trigger ?? 0) + 1,
      }));
    },
    [items, sessionId, revisionId],
  );
  const selectedId = selected?.id;
  const update = useCallback(
    (state: PronunciationState) => {
      if (selectedId)
        setPlayback({ sessionId, revisionId, state: { itemId: selectedId, ...state } });
    },
    [selectedId, sessionId, revisionId],
  );
  const player = selected ? (
    <PronunciationAudio
      key={`${sessionId}:${revisionId}:${selected.id}`}
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
      cache={pronunciationCache}
    />
  ) : null;
  return (
    <>
      <ClassNotesFrame
        html={html}
        title={model.title}
        pronunciationItems={items}
        onPronunciation={select}
        playback={
          selected &&
          playback?.sessionId === sessionId &&
          playback.revisionId === revisionId &&
          playback.state.itemId === selected.id
            ? playback.state
            : undefined
        }
        fitContent={fitContent}
      />
      {fitContent && selected ? (
        <aside className={styles.fallbackControls} aria-label="Pronunciation playback">
          <Button
            secondary
            className={styles.close}
            onClick={() => {
              setSelected(null);
              setPlayback(undefined);
            }}
          >
            Close pronunciation
          </Button>
          {player}
        </aside>
      ) : (
        player
      )}
    </>
  );
}
