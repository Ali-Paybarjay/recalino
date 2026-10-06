"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ClassNotesFrame.module.css";

/** The downloaded document is unchanged except for the frame's base URL and app theme. */
export function framedClassNotesHtml(html: string, theme?: "light" | "dark"): string {
  const document = html.replace("<head>", '<head><base href="about:srcdoc">');
  return theme ? document.replace(/<html\b([^>]*)>/, `<html$1 data-theme="${theme}">`) : document;
}

export function ClassNotesFrame({ html, title }: { html: string; title: string }) {
  const [theme, setTheme] = useState<"light" | "dark">();
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const frameDocument = useMemo(() => framedClassNotesHtml(html, theme), [html, theme]);
  return (
    <iframe
      className={styles.frame}
      title={`Class notes: ${title}`}
      srcDoc={frameDocument}
      sandbox=""
      referrerPolicy="no-referrer"
    />
  );
}
