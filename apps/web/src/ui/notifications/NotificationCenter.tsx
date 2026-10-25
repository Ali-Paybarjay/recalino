"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, IconButton } from "../components/Button";
import { Sheet } from "../components/Sheet";
import { Info, X } from "../icons";
import { useRecording } from "../recording/RecordingProvider";
import { WorkspaceRequestError, workspaceRequest } from "../workspace/api";
import { notificationCopy, notificationMessage } from "./copy";
import styles from "./NotificationCenter.module.css";
import {
  applicationServerKey,
  devicePushSubscription,
  disableDevicePush,
  supportsDevicePush,
} from "./push";

interface InboxItem {
  id: string;
  kind: "processing_ready" | "processing_partial" | "processing_failed";
  href: string;
  createdAt: string;
  readAt: string | null;
  classTitle: string | null;
}
interface Inbox {
  items: InboxItem[];
  unreadCount: number;
}
interface PushSettings {
  publicKey: string | null;
  subscribed: boolean;
}

export function NotificationCenter({ userId }: { userId: string }) {
  const { state: recording } = useRecording();
  const recordingActive = ["starting", "recording", "recovering", "paused", "saving"].includes(
    recording.phase,
  );
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<Inbox>({ items: [], unreadCount: 0 });
  const [alert, setAlert] = useState<InboxItem | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [push, setPush] = useState<PushSettings | null>(null);
  const [supported, setSupported] = useState(false);
  const [saving, setSaving] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await workspaceRequest<Inbox>(
      "/api/notifications",
      "GET",
      undefined,
      undefined,
      { signal },
    );
    signal?.throwIfAborted();
    if (seen.current) {
      const latest = result.items.find((item) => !seen.current?.has(item.id) && !item.readAt);
      if (latest) setAlert(latest);
    }
    seen.current = new Set(result.items.map((item) => item.id));
    setInbox(result);
  }, []);
  useEffect(() => {
    if (!userId) return;
    setInbox({ items: [], unreadCount: 0 });
    setAlert(null);
    const abort = new AbortController();
    let running = false;
    seen.current = null;
    const tick = async () => {
      if (running || abort.signal.aborted || document.hidden || !navigator.onLine) return;
      running = true;
      try {
        await refresh(abort.signal);
      } catch {
        /* The durable inbox remains available on the next successful poll. */
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 20_000);
    const visible = () => void tick();
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, userId]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setSupported(supportsDevicePush());
    void (async () => {
      const subscription = await devicePushSubscription();
      const result = await workspaceRequest<PushSettings>(
        `/api/notifications/push${subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : ""}`,
        "GET",
      );
      if (!cancelled) setPush(result);
    })().catch(() => {
      if (!cancelled) setPush({ publicKey: null, subscribed: false });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  async function showInbox() {
    setOpen(true);
    setProblem(null);
    try {
      await refresh();
    } catch {
      setProblem(notificationCopy.loadFailed);
    }
  }
  async function markRead(ids: string[]) {
    setSaving(true);
    setProblem(null);
    try {
      setInbox(await workspaceRequest<Inbox>("/api/notifications", "PATCH", { ids }));
    } catch {
      setProblem(notificationCopy.loadFailed);
    } finally {
      setSaving(false);
    }
  }
  async function togglePush() {
    setProblem(null);
    setSaving(true);
    try {
      if (push?.subscribed) {
        await disableDevicePush();
        setPush((value) => (value ? { ...value, subscribed: false } : value));
        return;
      }
      if (!push?.publicKey || !supported) return;
      // Keep the permission prompt inside the explicit tap, before any network await (Safari).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setProblem(notificationCopy.permissionDenied);
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(push.publicKey),
        }));
      await workspaceRequest("/api/notifications/push", "POST", subscription.toJSON());
      setPush((value) => (value ? { ...value, subscribed: true } : value));
    } catch (error) {
      setProblem(
        error instanceof WorkspaceRequestError &&
          error.fields?.devices?.includes("push_device_limit")
          ? notificationCopy.deviceLimit
          : notificationCopy.pushFailed,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className={styles.toolbar}>
        <Button icon={Info} onClick={() => void showInbox()} aria-haspopup="dialog">
          {notificationCopy.title}
          {inbox.unreadCount ? ` (${inbox.unreadCount})` : ""}
        </Button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={notificationCopy.title}>
        <div className={styles.settings}>
          <p>
            {push?.subscribed
              ? notificationCopy.pushEnabled
              : !supported
                ? notificationCopy.pushUnsupported
                : !push?.publicKey
                  ? notificationCopy.pushUnavailable
                  : notificationCopy.pushHint}
          </p>
          {supported && (push?.publicKey || push?.subscribed) ? (
            <Button onClick={() => void togglePush()} loading={saving}>
              {push.subscribed ? notificationCopy.disable : notificationCopy.enable}
            </Button>
          ) : null}
        </div>
        {problem ? (
          <p role="alert" className={styles.problem}>
            {problem}
          </p>
        ) : null}
        {inbox.unreadCount ? (
          <Button
            variant="ghost"
            loading={saving}
            onClick={() =>
              void markRead(inbox.items.filter((item) => !item.readAt).map((item) => item.id))
            }
          >
            {notificationCopy.markRead}
          </Button>
        ) : null}
        {!inbox.items.length ? (
          <p>{notificationCopy.empty}</p>
        ) : (
          <ul className={styles.list}>
            {inbox.items.map((item) => (
              <li
                key={item.id}
                className={item.readAt ? styles.item : `${styles.item} ${styles.unread}`}
              >
                {item.classTitle ? <h3 className={styles.classTitle}>{item.classTitle}</h3> : null}
                <p>{notificationMessage(item.kind)}</p>
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                <Link
                  href={item.href}
                  prefetch={false}
                  className={styles.result}
                  onClick={() => {
                    void markRead([item.id]);
                    setAlert(null);
                    setOpen(false);
                  }}
                >
                  {item.kind === "processing_failed"
                    ? notificationCopy.openProcessing
                    : notificationCopy.openResult}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
      {alert && !recordingActive ? (
        <div className={styles.alert}>
          <span role="status" className={styles.alertMessage}>
            {notificationMessage(alert.kind)}
          </span>
          <Link
            href={alert.href}
            className={styles.alertLink}
            onClick={() => {
              void markRead([alert.id]);
              setAlert(null);
            }}
          >
            {alert.kind === "processing_failed"
              ? notificationCopy.openProcessing
              : notificationCopy.openResult}
          </Link>
          <IconButton icon={X} label={notificationCopy.close} onClick={() => setAlert(null)} />
        </div>
      ) : null}
    </>
  );
}
