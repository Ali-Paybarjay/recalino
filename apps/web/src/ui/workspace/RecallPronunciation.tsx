"use client";
import { PronunciationAudio } from "./PronunciationAudio";

/** Mounted only after reveal; a card/set change disposes both requests and playback. */
export function RecallPronunciation({
  cardId,
  contentVersion,
  sessionId,
  target,
}: {
  cardId: string;
  contentVersion: number;
  sessionId: string;
  target: string;
}) {
  return (
    <PronunciationAudio
      sessionId={sessionId}
      request={{ kind: "pronunciation", cardId, expectedContentVersion: contentVersion }}
      target={target}
    />
  );
}
