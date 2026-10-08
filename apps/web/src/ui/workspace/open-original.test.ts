import { afterEach, expect, it, vi } from "vitest";
import { openOriginalTab } from "./open-original";

const signedUrl = "https://storage.example/original?token=private-original";

function deferredUrl() {
  let resolve!: (url: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function reservedTab() {
  const referrer = { name: "", content: "" };
  const tab = {
    opener: {} as object | null,
    closed: false,
    document: {
      createElement: vi.fn(() => referrer),
      head: { append: vi.fn() },
      title: "",
      body: { textContent: "" },
    },
    location: { replace: vi.fn() },
    close: vi.fn(),
  };
  const open = vi.fn(() => tab);
  vi.stubGlobal("window", { open });
  return { tab, referrer, open };
}

afterEach(() => vi.unstubAllGlobals());

// FR-SRC-007 / PRD-SEC-01: asynchronous private-file lookup keeps the click's tab.
it("reserves and isolates the tab before lookup, then navigates only after the URL resolves", async () => {
  const { tab, referrer, open } = reservedTab();
  const lookup = deferredUrl();
  const resolveUrl = vi.fn(() => {
    expect(open).toHaveBeenCalledExactlyOnceWith("about:blank", "_blank");
    expect(tab.opener).toBeNull();
    expect(tab.document.createElement).toHaveBeenCalledExactlyOnceWith("meta");
    expect(referrer).toEqual({ name: "referrer", content: "no-referrer" });
    expect(tab.document.head.append).toHaveBeenCalledExactlyOnceWith(referrer);
    expect(tab.document.title).toBe("Opening original");
    expect(tab.document.body.textContent).toBe("Opening original…");
    return lookup.promise;
  });

  const opening = openOriginalTab(resolveUrl);
  expect(resolveUrl).toHaveBeenCalledTimes(1);
  expect(tab.location.replace).not.toHaveBeenCalled();
  expect(tab.close).not.toHaveBeenCalled();

  lookup.resolve(signedUrl);
  await expect(opening).resolves.toEqual({ url: signedUrl, opened: true });
  expect(tab.location.replace).toHaveBeenCalledExactlyOnceWith(signedUrl);
  expect(open).toHaveBeenCalledTimes(1);
  expect(tab.close).not.toHaveBeenCalled();
});

it("returns a usable URL when the click's popup is blocked without opening a later popup", async () => {
  const open = vi.fn(() => null);
  vi.stubGlobal("window", { open });
  const lookup = deferredUrl();
  const resolveUrl = vi.fn(() => lookup.promise);

  const opening = openOriginalTab(resolveUrl);
  expect(open).toHaveBeenCalledExactlyOnceWith("about:blank", "_blank");
  expect(resolveUrl).toHaveBeenCalledTimes(1);
  lookup.resolve(signedUrl);

  await expect(opening).resolves.toEqual({ url: signedUrl, opened: false });
  expect(open).toHaveBeenCalledTimes(1);
});

it("returns the URL if the user closes the reserved tab during lookup without reopening it", async () => {
  const { tab, open } = reservedTab();
  const lookup = deferredUrl();
  const opening = openOriginalTab(() => lookup.promise);

  tab.closed = true;
  lookup.resolve(signedUrl);

  await expect(opening).resolves.toEqual({ url: signedUrl, opened: false });
  expect(tab.location.replace).not.toHaveBeenCalled();
  expect(tab.close).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(1);
});

it("closes the blank tab and preserves the lookup failure", async () => {
  const { tab, open } = reservedTab();
  const lookup = deferredUrl();
  const failure = new Error("The original could not be found.");
  const opening = openOriginalTab(() => lookup.promise);
  const rejected = expect(opening).rejects.toBe(failure);

  lookup.reject(failure);

  await rejected;
  expect(tab.close).toHaveBeenCalledTimes(1);
  expect(tab.location.replace).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(1);
});

it("preserves lookup failure when the popup was blocked", async () => {
  const open = vi.fn(() => null);
  vi.stubGlobal("window", { open });
  const failure = new Error("The private link expired.");

  await expect(openOriginalTab(() => Promise.reject(failure))).rejects.toBe(failure);
  expect(open).toHaveBeenCalledExactlyOnceWith("about:blank", "_blank");
});
