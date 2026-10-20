import { describe, expect, it, vi } from "vitest";
import { followSessionAddress, sessionAddress, sessionPageBack } from "./session-page";

const session = "20000000-0000-4000-8000-000000000001";
const href = `/sessions/${session}/record`;
const today = { pageSessionId: undefined, recordingSessionId: session };
function page(pathname = "/recordings") {
  const replaceState = vi.fn((_data: unknown, _unused: string, url?: string | URL | null) => {
    if (url) location.pathname = String(url);
  });
  const location = { pathname };
  // A history entry and its address only: no router, so nothing here can load a page.
  return { location, history: { replaceState }, replaceState };
}

// D107 A.4, PRD-REC-02/03: the session attaches without a server navigation, during capture and
// after Stop alike, online or not.
describe("Today's recording page takes the session's address", () => {
  it("replaces the address once, and nothing else", () => {
    const target = page();
    followSessionAddress(today, target);
    expect(target.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", href);
    expect(target.location.pathname).toBe(href);
    // Every later render (a part rotates, Stop, a photo picker opened or cancelled) is a no-op.
    followSessionAddress(today, target);
    expect(target.replaceState).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a session's page or before the session is known", () => {
    const target = page();
    followSessionAddress({ pageSessionId: session, recordingSessionId: session }, target);
    followSessionAddress({ pageSessionId: undefined, recordingSessionId: null }, target);
    expect(target.replaceState).not.toHaveBeenCalled();
    expect(sessionAddress({ pageSessionId: session, recordingSessionId: session })).toBeNull();
  });

  it("leads back to the session once the page has its address, else where the page says", () => {
    expect(sessionPageBack(today)).toBe(`/sessions/${session}`);
    expect(sessionPageBack({ pageSessionId: undefined, recordingSessionId: null })).toBeNull();
    expect(sessionPageBack({ pageSessionId: session, recordingSessionId: session })).toBeNull();
  });
});
