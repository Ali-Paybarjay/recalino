import "server-only";
import {
  type BrowserPushSubscription,
  browserPushDeliveryJob,
  emptyPayload,
  isBrowserPushEndpoint,
  type LearnerNotification,
  type PeriodicJob,
} from "@recalino/core/plt";
import { reconcileProcessingNotifications } from "@recalino/core/proc";
import webPush from "web-push";
import { finalizeAutomaticRun } from "./automatic-learning-publication";

export function readWebPushConfiguration() {
  const publicKey = process.env.RECALINO_WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.RECALINO_WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.RECALINO_WEB_PUSH_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  if (
    !/^([A-Za-z0-9_-]{87})$/.test(publicKey) ||
    !/^[A-Za-z0-9_-]{43}$/.test(privateKey) ||
    !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)
  )
    return null;
  return { publicKey, privateKey, subject };
}

async function sendBrowserPush(
  subscription: BrowserPushSubscription,
  notification: LearnerNotification,
) {
  const configuration = readWebPushConfiguration();
  if (!configuration) throw new Error("push_unconfigured");
  // Recheck persisted endpoints as well as the incoming subscription API.
  if (!isBrowserPushEndpoint(subscription.endpoint)) return "expired" as const;
  try {
    await webPush.sendNotification(
      subscription,
      JSON.stringify({
        id: notification.id,
        kind: notification.kind,
        href: notification.href,
        // Keep private session names and contents off the lock screen.
        title: "Recalino",
        body:
          notification.kind === "processing_ready"
            ? "Your session materials are ready."
            : notification.kind === "processing_partial"
              ? "Your session materials are partly ready. Check the result."
              : "Your session materials need your attention.",
      }),
      {
        vapidDetails: configuration,
        timeout: 10_000,
        TTL: 86_400,
        urgency: "normal",
        topic: notification.id.replaceAll("-", ""),
      },
    );
    return "sent" as const;
  } catch (error) {
    const status =
      error !== null && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : undefined;
    if (status === 404 || status === 410) return "expired" as const;
    throw new Error("push_delivery_failed");
  }
}

export function processingNotificationDefinitions() {
  return [browserPushDeliveryJob(sendBrowserPush)];
}
export function processingNotificationPeriodicJobs(): PeriodicJob[] {
  return [
    {
      everySeconds: 60,
      definition: {
        kind: "proc.notify_completed",
        version: 1,
        payload: emptyPayload,
        async run(_payload, job) {
          await reconcileProcessingNotifications(job.db, job.now(), {
            beforeRecord: (ctx, runId) => finalizeAutomaticRun(job.db, ctx, runId, job.now()),
          });
        },
      },
    },
  ];
}
