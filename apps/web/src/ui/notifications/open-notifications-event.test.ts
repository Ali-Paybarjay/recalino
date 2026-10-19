import { expect, it, vi } from "vitest";
import { OPEN_NOTIFICATIONS_EVENT, openNotifications } from "./open-notifications-event";

it("asks the Notifications panel to open with one named event", () => {
  const dispatchEvent = vi.fn(() => true);
  openNotifications({ dispatchEvent });
  expect(dispatchEvent).toHaveBeenCalledTimes(1);
  const [event] = dispatchEvent.mock.calls[0] as unknown as [Event];
  expect(event.type).toBe(OPEN_NOTIFICATIONS_EVENT);
});
