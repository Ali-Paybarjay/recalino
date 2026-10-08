// Background completion copy approved by the user's 2026-10-08 implementation request.
export const notificationCopy = {
  title: "Notifications",
  ready: "Your class materials are ready.",
  partial: "Your class materials are partly ready. Check the missing materials.",
  failed: "Your class materials need your attention. Open processing for the next step.",
  openResult: "Open result",
  openProcessing: "Open processing",
  newAlert: "New notification",
  empty: "No notifications yet. Your processing results will appear here.",
  markRead: "Mark shown notifications as read",
  enable: "Notify me when materials are ready",
  disable: "Turn off notifications on this device",
  pushEnabled:
    "Notifications are enabled on this device. You can close the app after upload finishes.",
  pushHint:
    "Receive a notification when processing finishes, even after closing the app. Class names and contents stay private on the lock screen.",
  pushUnsupported:
    "This browser does not support notifications. On iPhone or iPad, add Recalino to the Home Screen and open it there. Results stay in this inbox.",
  pushUnavailable: "Device notifications are not available yet. Results stay in this inbox.",
  permissionDenied:
    "Notifications are blocked in this browser. Allow them in your browser settings, then try again.",
  loadFailed: "Notifications could not be loaded. Try again.",
  pushFailed: "Notification settings could not be saved. Try again.",
  deviceLimit:
    "Notifications are enabled on too many devices. Turn them off on another device, then try again.",
  close: "Dismiss notification",
} as const;
export function notificationMessage(kind: string) {
  return kind === "processing_ready"
    ? notificationCopy.ready
    : kind === "processing_partial"
      ? notificationCopy.partial
      : notificationCopy.failed;
}
