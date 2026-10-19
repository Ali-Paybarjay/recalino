import { expect, it, vi } from "vitest";
import { OPEN_TERMS_NOTICE_EVENT, openTermsNotice } from "./terms-notice-event";

it("asks the Terms banner to open its sheet with one named event", () => {
  const dispatchEvent = vi.fn(() => true);
  openTermsNotice({ dispatchEvent });
  expect(dispatchEvent).toHaveBeenCalledTimes(1);
  const [event] = dispatchEvent.mock.calls[0] as unknown as [Event];
  expect(event.type).toBe(OPEN_TERMS_NOTICE_EVENT);
});
