/* Push-only service worker. It deliberately never caches private pages or API responses. */
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  if (!payload || typeof payload.id !== "string") return;
  const href =
    typeof payload.href === "string" &&
    /^\/classes\/[0-9a-f-]{36}\/(notes|processing)$/.test(payload.href)
      ? payload.href
      : "/classes";
  event.waitUntil(
    self.registration.showNotification("Recalino", {
      body: typeof payload.body === "string" ? payload.body : "Your class materials are ready.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.id,
      silent: true,
      data: { href, id: payload.id },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href;
  const path =
    typeof href === "string" && /^\/classes\/[0-9a-f-]{36}\/(notes|processing)$/.test(href)
      ? href
      : "/classes";
  event.waitUntil(
    (async () => {
      const target = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existing) {
        await existing.navigate(target);
        await existing.focus();
      } else await self.clients.openWindow(target);
      if (typeof event.notification.data?.id === "string") {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: [event.notification.data.id] }),
        }).catch(() => {});
      }
    })(),
  );
});
