"use client";
import type { FeedbackSummary, FeedbackThread } from "@recalino/core/support";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Field, TextArea, TextInput } from "../components/Field";
import { Panel } from "../workspace/primitives";
import { supportCopy as copy } from "./copy";
import styles from "./Support.module.css";

type Category = keyof typeof copy.categories;
function saveDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function removeDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}
function when(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
async function send(path: string, input: unknown, key: string): Promise<FeedbackThread> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("send_failed");
  return response.json() as Promise<FeedbackThread>;
}
export function SupportList({
  initial,
  timezone = "UTC",
}: {
  initial: FeedbackSummary[];
  timezone?: string;
}) {
  return (
    <div className={styles.stack}>
      <div className={styles.header}>
        <p className={styles.muted}>{copy.introduction}</p>
        <Link className="btn btn-primary" href="/help/new">
          {copy.newMessage}
        </Link>
      </div>
      <Panel title={copy.myMessages}>
        {initial.length ? (
          <ul className={styles.messages}>
            {initial.map((thread) => (
              <li key={thread.id}>
                <Link className={styles.item} href={`/help/${thread.id}`}>
                  <div className={styles.itemHead}>
                    <strong dir="auto">{thread.subject}</strong>
                    <span className={styles.status}>
                      {thread.unread ? "Unread reply · " : ""}
                      {copy.statuses[thread.status]}
                    </span>
                  </div>
                  <p className={styles.muted}>{when(thread.updatedAt, timezone)}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{copy.empty}</p>
        )}
      </Panel>
    </div>
  );
}
export function SupportForm({ userId, email }: { userId: string; email: string | null }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>("question");
  const [notification, setNotification] = useState(true);
  const [context, setContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const storageKey = `recalino:support:draft:${userId}`;
  useEffect(() => {
    let parsed: {
      subject?: string;
      body?: string;
      category?: Category;
      notification?: boolean;
      context?: boolean;
      key?: string;
    } = {};
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) parsed = JSON.parse(saved) ?? {};
    } catch {}
    setSubject(typeof parsed.subject === "string" ? parsed.subject : "");
    setBody(typeof parsed.body === "string" ? parsed.body : "");
    setCategory(
      parsed.category && Object.hasOwn(copy.categories, parsed.category)
        ? parsed.category
        : "question",
    );
    setNotification(typeof parsed.notification === "boolean" ? parsed.notification : true);
    setContext(typeof parsed.context === "boolean" ? parsed.context : false);
    key.current = typeof parsed.key === "string" ? parsed.key : null;
    // A rendered restoration gate prevents initial/Strict Mode autosave from replacing saved text with empty defaults.
    setRestoredKey(storageKey);
  }, [storageKey]);
  useEffect(() => {
    if (restoredKey !== storageKey) return;
    saveDraft(storageKey, { subject, body, category, notification, context, key: key.current });
  }, [restoredKey, storageKey, subject, body, category, notification, context]);
  function edit(change: () => void) {
    key.current = null;
    change();
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!navigator.onLine) {
      setFailure(copy.offline);
      return;
    }
    setBusy(true);
    setFailure(null);
    key.current ??= crypto.randomUUID();
    try {
      saveDraft(storageKey, { subject, body, category, notification, context, key: key.current });
      const result = await send(
        "/api/support",
        {
          subject,
          body,
          category,
          emailNotification: notification,
          ...(context ? { context: { appVersion: "web", screen: "help/new" } } : {}),
        },
        key.current,
      );
      removeDraft(storageKey);
      router.push(`/help/${result.id}?received=1`);
      router.refresh();
    } catch {
      setFailure(copy.failed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.stack}>
      <Link href="/help">{copy.myMessages}</Link>
      <Panel title={copy.newMessage}>
        <form className={styles.form} onSubmit={submit}>
          <Field id="support-category" label={copy.category}>
            {(control) => (
              <select
                {...control}
                className="input"
                value={category}
                disabled={busy}
                onChange={(event) => edit(() => setCategory(event.target.value as Category))}
              >
                {Object.entries(copy.categories).map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="support-subject" label={copy.subject}>
            {(control) => (
              <TextInput
                {...control}
                value={subject}
                disabled={busy}
                maxLength={200}
                required
                onChange={(event) => edit(() => setSubject(event.target.value))}
              />
            )}
          </Field>
          <Field id="support-body" label={copy.message}>
            {(control) => (
              <TextArea
                {...control}
                value={body}
                disabled={busy}
                maxLength={10000}
                required
                placeholder={copy.placeholder}
                onChange={(event) => edit(() => setBody(event.target.value))}
              />
            )}
          </Field>
          <label className={styles.option}>
            <input
              type="checkbox"
              checked={notification}
              disabled={busy}
              onChange={(event) => edit(() => setNotification(event.target.checked))}
            />
            <span>
              {copy.notification}
              {email && (
                <small className={styles.muted}>
                  <br />
                  <bdi>{email}</bdi>
                </small>
              )}
            </span>
          </label>
          <label className={styles.option}>
            <input
              type="checkbox"
              checked={context}
              disabled={busy}
              onChange={(event) => edit(() => setContext(event.target.checked))}
            />
            <span>
              {copy.context}
              <small className={styles.muted}>
                <br />
                {copy.contextHint}
              </small>
            </span>
          </label>
          {failure && (
            <p className={styles.error} role="alert">
              {failure}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={busy}>
              {busy ? copy.sending : copy.send}
            </Button>
            <Link className="btn btn-secondary" href="/help">
              Cancel
            </Link>
          </div>
        </form>
      </Panel>
    </div>
  );
}
export function SupportConversation({
  initial,
  received = false,
  timezone = "UTC",
}: {
  initial: FeedbackThread;
  received?: boolean;
  timezone?: string;
}) {
  const [thread, setThread] = useState(initial);
  const [body, setBody] = useState("");
  const [notification, setNotification] = useState(initial.emailNotification);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState(received);
  const key = useRef<string | null>(null);
  const storageKey = `recalino:support:followup:${thread.userId}:${thread.id}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { body?: string; key?: string; notification?: boolean };
        setBody(parsed.body ?? "");
        key.current = parsed.key ?? null;
        if (typeof parsed.notification === "boolean") setNotification(parsed.notification);
      }
    } catch {}
  }, [storageKey]);
  function edit(value: string) {
    key.current = null;
    setBody(value);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ body: value, key: null, notification }));
    } catch {}
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    key.current ??= crypto.randomUUID();
    try {
      saveDraft(storageKey, { body, key: key.current, notification });
      const next = await send(
        `/api/support/${thread.id}`,
        { body, emailNotification: notification },
        key.current,
      );
      setThread(next);
      setBody("");
      key.current = null;
      removeDraft(storageKey);
      setSuccess(true);
    } catch {
      setFailure(navigator.onLine ? copy.failed : copy.offline);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.stack}>
      <Link href="/help">{copy.myMessages}</Link>
      {success && (
        <p role="status" className={styles.muted}>
          {copy.received}
        </p>
      )}
      <Panel title={thread.subject}>
        <p className={styles.status}>{copy.statuses[thread.status]}</p>
        <ol className={styles.messages}>
          {thread.messages.map((message) => (
            <li
              key={message.id}
              className={`${styles.message} ${message.author === "admin" ? styles.admin : ""}`}
            >
              <div className={styles.itemHead}>
                <strong>{message.author === "admin" ? copy.team : copy.you}</strong>
                <time className={styles.muted} dateTime={message.createdAt}>
                  {when(message.createdAt, timezone)}
                </time>
              </div>
              <p dir="auto" className={styles.body}>
                {message.body}
              </p>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title={copy.reply}>
        <form className={styles.form} onSubmit={submit}>
          <Field id="support-reply" label={copy.reply}>
            {(control) => (
              <TextArea
                {...control}
                value={body}
                disabled={busy}
                maxLength={10000}
                required
                onChange={(event) => edit(event.target.value)}
              />
            )}
          </Field>
          <label className={styles.option}>
            <input
              type="checkbox"
              checked={notification}
              disabled={busy}
              onChange={(event) => {
                key.current = null;
                setNotification(event.target.checked);
                saveDraft(storageKey, { body, notification: event.target.checked, key: null });
              }}
            />
            <span>{copy.notification}</span>
          </label>
          {failure && (
            <p className={styles.error} role="alert">
              {failure}
            </p>
          )}
          <Button type="submit" variant="primary" loading={busy}>
            {busy ? copy.sending : copy.sendReply}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
