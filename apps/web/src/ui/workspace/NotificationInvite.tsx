"use client";
import { useSyncExternalStore } from "react";
import { Button } from "../components/Button";
import { openNotifications } from "../notifications/open-notifications-event";
import { supportsDevicePush } from "../notifications/push";
import { useCaptureQuiet } from "../recording/RecordingProvider";
import styles from "./AutomaticLearningView.module.css";
import { learningProgressCopy } from "./learning-progress-copy";

const NO_UPDATES = () => () => {};
/** Only a browser that was never asked: after "granted" or "denied" the invite would nag. */
const neverAsked = () => supportsDevicePush() && Notification.permission === "default";

/**
 * UX-13: the invitation to turn on notifications while notes are being made. The sentence is the
 * owner's (2026-10-19); the second half opens the Notifications panel, which holds the switch.
 * It stays away while a session is being recorded (PRD-REC-02) and where the browser has no push.
 */
export function NotificationInvite() {
  const askable = useSyncExternalStore(NO_UPDATES, neverAsked, () => false);
  const recording = useCaptureQuiet();
  if (!askable || recording) return null;
  return (
    <p className={styles.detail}>
      {learningProgressCopy.notificationQuestion}{" "}
      <Button variant="ghost" onClick={() => openNotifications()}>
        {learningProgressCopy.notificationAction}
      </Button>
    </p>
  );
}
