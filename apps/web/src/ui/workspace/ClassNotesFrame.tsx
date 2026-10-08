"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ClassNotesFrame.module.css";
import {
  interactiveClassNotesHtml,
  type NotePronunciationItem,
  type NotePronunciationPlayback,
  pronunciationMessageItem,
} from "./class-notes-pronunciation";

/** The downloaded document is unchanged except for the frame's base URL and app theme. */
export function framedClassNotesHtml(html: string, theme?: "light" | "dark"): string {
  const document = html.replace("<head>", '<head><base href="about:srcdoc">');
  return theme ? document.replace(/<html\b([^>]*)>/, `<html$1 data-theme="${theme}">`) : document;
}

export function ClassNotesFrame({
  html,
  title,
  pronunciationItems = [],
  onPronunciation,
  playback,
}: {
  html: string;
  title: string;
  pronunciationItems?: readonly NotePronunciationItem[];
  onPronunciation?: (itemId: string) => void;
  playback?: NotePronunciationPlayback;
}) {
  const [theme, setTheme] = useState<"light" | "dark">();
  const frame = useRef<HTMLIFrameElement>(null);
  const [identity, setIdentity] = useState<{ html: string; channel: string; nonce: string }>();
  useEffect(() => {
    setIdentity({ html, channel: crypto.randomUUID(), nonce: crypto.randomUUID() });
  }, [html]);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const interactive = !!onPronunciation && pronunciationItems.length > 0 && identity?.html === html;
  const eligible = useMemo(
    () => new Set(pronunciationItems.map((item) => item.id)),
    [pronunciationItems],
  );
  const frameDocument = useMemo(() => {
    if (!interactive || !identity) return framedClassNotesHtml(html, theme);
    const document = framedClassNotesHtml(html, theme);
    return interactiveClassNotesHtml(
      document,
      pronunciationItems,
      identity.channel,
      identity.nonce,
    );
  }, [html, theme, interactive, identity, pronunciationItems]);
  useEffect(() => {
    if (!interactive || !identity) return;
    const listener = (event: MessageEvent) => {
      const item = pronunciationMessageItem(
        event,
        frame.current?.contentWindow ?? null,
        identity.channel,
        eligible,
      );
      if (item) onPronunciation?.(item);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [interactive, identity, eligible, onPronunciation]);
  const restorePlayback = useCallback(() => {
    if (interactive && identity && playback)
      frame.current?.contentWindow?.postMessage(
        { type: "recalino:pronunciation-state", channel: identity.channel, state: playback },
        "*",
      );
  }, [interactive, identity, playback]);
  useEffect(restorePlayback, [restorePlayback]);
  return (
    <iframe
      key={interactive && identity ? identity.channel : "passive"}
      ref={frame}
      className={styles.frame}
      title={`Session notes: ${title}`}
      srcDoc={frameDocument}
      sandbox={interactive ? "allow-scripts" : ""}
      referrerPolicy="no-referrer"
      onLoad={restorePlayback}
    />
  );
}
