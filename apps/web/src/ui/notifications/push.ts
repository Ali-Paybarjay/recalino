export function supportsDevicePush(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
export async function devicePushSubscription() {
  if (!supportsDevicePush()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.pushManager.getSubscription() ?? null;
}
export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

/** Sign-out and explicit disable both revoke the server recipient before dropping the browser key. */
export async function disableDevicePush() {
  const subscription = await devicePushSubscription();
  if (!subscription) return;
  const response = await fetch("/api/notifications/push", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw new Error("push_disable_failed");
  await subscription.unsubscribe();
}
