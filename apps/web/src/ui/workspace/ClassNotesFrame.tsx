"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ClassNotesFrame.module.css";
import {
  interactiveClassNotesHtml,
  NOTES_READER_MIN_HEIGHT,
  type NotePronunciationItem,
  type NotePronunciationPlayback,
  notesReaderMessage,
  pronunciationMessageItem,
} from "./class-notes-pronunciation";

const noPronunciationItems: readonly NotePronunciationItem[] = [];

/** The downloaded document is unchanged except for the frame's base URL and app theme. */
export function framedClassNotesHtml(html: string, theme?: "light" | "dark"): string {
  const document = html.replace("<head>", '<head><base href="about:srcdoc">');
  return theme ? document.replace(/<html\b([^>]*)>/, `<html$1 data-theme="${theme}">`) : document;
}

export function ClassNotesFrame({
  html,
  title,
  pronunciationItems = noPronunciationItems,
  onPronunciation,
  playback,
  fitContent = false,
}: {
  html: string;
  title: string;
  pronunciationItems?: readonly NotePronunciationItem[];
  onPronunciation?: (itemId: string) => void;
  playback?: NotePronunciationPlayback;
  fitContent?: boolean;
}) {
  const [theme, setTheme] = useState<"light" | "dark">();
  const frame = useRef<HTMLIFrameElement>(null);
  const [identity, setIdentity] = useState<{
    html: string;
    theme: "light" | "dark" | undefined;
    fitContent: boolean;
    channel: string;
    nonce: string;
  }>();
  // Keep the reader's space while a replacement document starts its authenticated bridge.
  const [frameHeight, setFrameHeight] = useState(NOTES_READER_MIN_HEIGHT);
  useEffect(() => {
    setIdentity({
      html,
      theme,
      fitContent,
      channel: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
    });
  }, [html, theme, fitContent]);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const currentDocument =
    identity?.html === html && identity.theme === theme && identity.fitContent === fitContent;
  const interactive = !!onPronunciation && pronunciationItems.length > 0 && currentDocument;
  const bridged = (interactive || fitContent) && currentDocument;
  const eligible = useMemo(
    () => new Set(pronunciationItems.map((item) => item.id)),
    [pronunciationItems],
  );
  const frameDocument = useMemo(() => {
    if (!bridged || !identity) return framedClassNotesHtml(html, theme);
    const document = framedClassNotesHtml(html, theme);
    return interactiveClassNotesHtml(
      document,
      interactive ? pronunciationItems : [],
      identity.channel,
      identity.nonce,
      { fitContent },
    );
  }, [html, theme, bridged, interactive, identity, pronunciationItems, fitContent]);
  useEffect(() => {
    if (!bridged || !identity) return;
    let anchorScroll: number | undefined;
    const listener = (event: MessageEvent) => {
      const frameWindow = frame.current?.contentWindow ?? null;
      if (interactive) {
        const item = pronunciationMessageItem(event, frameWindow, identity.channel, eligible);
        if (item) onPronunciation?.(item);
      }
      if (!fitContent) return;
      const message = notesReaderMessage(event, frameWindow, identity.channel);
      if (message?.type === "resize") setFrameHeight(message.height);
      if (message?.type === "anchor") {
        if (anchorScroll !== undefined) window.cancelAnimationFrame(anchorScroll);
        // Apply the document height before moving the outer page to an anchor far below the fold.
        anchorScroll = window.requestAnimationFrame(() => {
          const element = frame.current;
          if (!element || element.contentWindow !== frameWindow) return;
          const headerOffset = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 88;
          window.scrollBy({
            top: element.getBoundingClientRect().top + message.offset - headerOffset,
            behavior: "auto",
          });
        });
      }
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      if (anchorScroll !== undefined) window.cancelAnimationFrame(anchorScroll);
    };
  }, [bridged, interactive, fitContent, identity, eligible, onPronunciation]);
  const restorePlayback = useCallback(() => {
    if (fitContent && bridged && identity)
      frame.current?.contentWindow?.postMessage(
        { type: "recalino:notes-measure", channel: identity.channel },
        "*",
      );
    if (interactive && identity)
      frame.current?.contentWindow?.postMessage(
        {
          type: "recalino:pronunciation-state",
          channel: identity.channel,
          state: playback ?? null,
        },
        "*",
      );
  }, [fitContent, bridged, interactive, identity, playback]);
  useEffect(restorePlayback, [restorePlayback]);
  return (
    <iframe
      key={bridged && identity ? identity.channel : "passive"}
      ref={frame}
      className={`${styles.frame}${fitContent ? ` ${styles.fitContent}` : ""}`}
      style={fitContent ? { height: frameHeight } : undefined}
      title={`Session notes: ${title}`}
      srcDoc={frameDocument}
      sandbox={bridged ? "allow-scripts" : ""}
      scrolling={fitContent ? "no" : undefined}
      referrerPolicy="no-referrer"
      onLoad={restorePlayback}
    />
  );
}
