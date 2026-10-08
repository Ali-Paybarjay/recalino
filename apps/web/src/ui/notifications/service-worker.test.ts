import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("shows a silent tagged completion after the page closes and restricts click navigation to owned app paths", async () => {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const showNotification = vi.fn(async () => {});
  const openWindow = vi.fn(async () => {});
  const fetch = vi.fn(async () => ({}));
  runInNewContext(readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8"), {
    URL,
    fetch,
    self: {
      addEventListener: (name: string, fn: (event: Record<string, unknown>) => void) =>
        listeners.set(name, fn),
      location: { origin: "https://recalino.example" },
      registration: { showNotification },
      clients: { matchAll: async () => [], openWindow },
    },
  });
  const id = "c1b715d0-7d32-4d1a-a0bc-7b0101bd8b49";
  const path = `/classes/${id}/notes`;
  const tasks: Promise<unknown>[] = [];
  listeners.get("push")?.({
    data: { json: () => ({ id, href: path, body: "Your class materials are ready." }) },
    waitUntil: (promise: Promise<unknown>) => tasks.push(promise),
  });
  await Promise.all(tasks);
  expect(showNotification).toHaveBeenCalledWith(
    "Recalino",
    expect.objectContaining({ tag: id, silent: true, data: { href: path, id } }),
  );
  expect(listeners.has("fetch")).toBe(false);
  const close = vi.fn();
  listeners.get("notificationclick")?.({
    notification: { close, data: { href: "https://attacker.example/", id } },
    waitUntil: (promise: Promise<unknown>) => tasks.push(promise),
  });
  await Promise.all(tasks);
  expect(openWindow).toHaveBeenCalledWith("https://recalino.example/classes");
  expect(fetch).toHaveBeenCalledWith(
    "/api/notifications",
    expect.objectContaining({ method: "PATCH" }),
  );
  expect(close).toHaveBeenCalledOnce();
});
