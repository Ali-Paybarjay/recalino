import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureState } from "./controller";
import { RecordingView } from "./RecordingView";
import type { Recording } from "./store";
import type { PartScope } from "./visible-parts";

type Sync = { phase: "idle" | "syncing" | "failed"; count: number; pending: number; error: string };
const mocks = vi.hoisted(() => ({
  phase: "idle" as CaptureState["phase"],
  error: null as string | null,
  recording: null as Recording | null,
  sync: { phase: "idle", count: 0, pending: 0, error: "" } as Sync,
  // The list loads from IndexedDB in an effect, which a server render never runs; the scope
  // stands in for the rows the page would list.
  scope: null as PartScope | null,
  learning: null as null | { processRequest: string; revision: number; requestedRevision: number },
  // When set, only this session has the status above.
  learningSession: null as string | null,
}));
vi.mock("../workspace/AutomaticLearningProvider", () => ({
  useAutomaticLearning: (id: string) => ({
    status: !mocks.learningSession || mocks.learningSession === id ? mocks.learning : null,
    acceptStatus: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("./RecordingProvider", () => ({
  RecordLauncher: () => null,
  ensureRecordingClass: vi.fn(),
  useRecording: () => ({
    controller: {
      elapsed: () => 0,
      segmentElapsed: () => 0,
      state: { recording: mocks.recording, phase: mocks.phase },
    },
    state: {
      recording: mocks.recording,
      phase: mocks.phase,
      error: mocks.error,
      accountDeletionBlocked: false,
      missing: null,
    },
    store: {},
    userId: "10000000-0000-4000-8000-000000000002",
    sourceSync: { retry: vi.fn() },
    syncState: mocks.sync,
  }),
}));
vi.mock("./visible-parts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./visible-parts")>();
  return {
    ...actual,
    partScope: (...args: Parameters<typeof actual.partScope>) =>
      mocks.scope ?? actual.partScope(...args),
  };
});

const failedSync: Sync = {
  phase: "failed",
  count: 1,
  pending: 2,
  error: "The recorded parts could not be added to your session. Check your connection.",
};
const session = "20000000-0000-4000-8000-000000000001";
function part(segment: number, patch: Partial<Recording> = {}): Recording {
  const id = `30000000-0000-4000-8000-00000000000${segment}`;
  return {
    id,
    userId: "10000000-0000-4000-8000-000000000002",
    sessionId: session,
    captureId: "30000000-0000-4000-8000-000000000001",
    segment,
    creationKey: "40000000-0000-4000-8000-000000000001",
    sourceAssetId: null,
    autoRegister: true,
    autoGenerate: true,
    mimeType: "audio/webm",
    status: "saved",
    activeMs: 61_000 * segment,
    chunks: 1,
    bytes: 5,
    completedAt: "2026-10-20T10:00:00.000Z",
    createdAt: `2026-10-20T09:0${segment}:00.000Z`,
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...patch,
  };
}
const render = (
  props: { backHref?: string; backLabel?: string; sessionId?: string | null } = {},
) => {
  const { sessionId = "session-1", ...rest } = props;
  return renderToStaticMarkup(
    createElement(RecordingView, { ...(sessionId ? { sessionId } : {}), ...rest }),
  );
};
beforeEach(() => {
  mocks.phase = "idle";
  mocks.error = null;
  mocks.recording = null;
  mocks.sync = { phase: "idle", count: 0, pending: 0, error: "" };
  mocks.scope = null;
  mocks.learning = null;
  mocks.learningSession = null;
});

// UX-11 and PRD-REC-02: until Stop, nothing but a real capture failure may speak.
describe("messages while recording", () => {
  // An earlier recording of the session waits to be added while a new one runs.
  const waiting = () => {
    mocks.recording = part(2, { completedAt: undefined, status: "recording" });
    mocks.scope = { kind: "recording", sessionId: session, rows: [part(1), mocks.recording] };
  };

  it.each(["starting", "recording", "recovering", "paused"] as const)(
    "keeps an upload failure out of the page while %s",
    (phase) => {
      mocks.phase = phase;
      mocks.sync = failedSync;
      waiting();
      const html = render();
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain(failedSync.error);
      expect(html).not.toContain("Retry adding session material");
      expect(html).not.toContain("Adding recorded parts to your session");
    },
  );

  it("still shows a real capture failure at once", () => {
    mocks.phase = "recording";
    mocks.error = "The microphone stopped. Tap Resume to try again.";
    mocks.sync = failedSync;
    waiting();
    const html = render();
    expect(html).toContain("The microphone stopped. Tap Resume to try again.");
    expect(html).not.toContain("Retry adding session material");
  });

  it("shows the upload failure of the listed parts and its Retry as soon as Stop was pressed", () => {
    mocks.sync = failedSync;
    waiting();
    for (const phase of ["saving", "saved", "idle"] as const) {
      mocks.phase = phase;
      const html = render();
      expect(html).toContain(failedSync.error);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Retry adding session material");
    }
  });

  it("says nothing about another session's parts (D107)", () => {
    mocks.phase = "saved";
    mocks.sync = failedSync;
    mocks.recording = part(1, { sourceAssetId: "sent" });
    mocks.scope = { kind: "recording", sessionId: session, rows: [mocks.recording] };
    const html = render();
    expect(html).not.toContain(failedSync.error);
    expect(html).not.toContain("Adding recorded parts to your session");
  });
});

describe("the recording page without navigation (UX-02)", () => {
  it("puts Stop and save before the explanations while recording", () => {
    mocks.phase = "recording";
    const html = render({ backHref: "/sessions/session-1" });
    expect(html.indexOf("Stop and save")).toBeGreaterThan(-1);
    expect(html.indexOf("Stop and save")).toBeLessThan(html.indexOf("Recording continues"));
  });

  it("hides the way back during capture and shows it afterwards", () => {
    mocks.phase = "recording";
    expect(render({ backHref: "/sessions/session-1" })).not.toContain("Back to session");
    mocks.phase = "paused";
    expect(render({ backHref: "/sessions/session-1" })).not.toContain("Back to session");
    for (const phase of ["idle", "saved", "failed"] as const) {
      mocks.phase = phase;
      const html = render({ backHref: "/sessions/session-1" });
      expect(html).toContain('href="/sessions/session-1"');
      expect(html).toContain("Back to session");
    }
  });

  it("adds no back link when the page has navigation of its own", () => {
    expect(render()).not.toContain("Back to session");
  });

  // D107: a Today recording's page takes the session's address and stays as it is after Stop (no
  // server navigation, which offline would end on the browser's error page); a board photo
  // picker opened and cancelled has no say in it.
  it("leads a Today recording back to its session after Stop, on the same page", () => {
    const today = { sessionId: null, backHref: "/today", backLabel: "Back to Today" };
    mocks.phase = "saved";
    mocks.recording = part(1, { sessionId: null });
    mocks.scope = { kind: "recording", sessionId: null, rows: [mocks.recording] };
    let html = render(today);
    expect(html).toContain('href="/today"');
    expect(html).not.toContain("Back to session");

    mocks.recording = part(1);
    mocks.scope = { kind: "recording", sessionId: session, rows: [mocks.recording] };
    html = render(today);
    expect(html).toContain(`href="/sessions/${session}"`);
    expect(html).toContain("Back to session");
    expect(html).not.toContain("Back to Today");
    expect(html).toContain(">Continue recording<");
    expect(html).toContain("Saved on this device");
  });
});

// D107 (owner decision 2026-10-20): this session's parts only, one numbered line each.
describe("the recorded parts", () => {
  it("lists every part with its number during capture, with no controls and no live region", () => {
    mocks.phase = "recording";
    mocks.recording = part(2, { completedAt: undefined, status: "recording" });
    mocks.scope = { kind: "recording", sessionId: session, rows: [part(1), mocks.recording] };
    const html = render();
    expect(html).toContain("Recorded parts");
    expect(html).toContain("Part 1 · 1:01");
    // The live part shows the running length of the part, not the saved one.
    expect(html).toContain("Part 2 · 0:00");
    expect(html.indexOf("Part 1 ·")).toBeLessThan(html.indexOf("Part 2 ·"));
    expect(html).toContain("Recording in progress");
    for (const control of ["Listen", "Export audio", "Remove from this device"])
      expect(html).not.toContain(`aria-label="${control}"`);
    expect(html).not.toContain(">Continue recording<");
    expect(html).not.toContain(">Process this session<");
    const list = html.slice(html.indexOf("<ol"), html.indexOf("</ol>"));
    expect(list).not.toMatch(/role="(status|alert)"/);
  });

  it("after Stop keeps the session open: Process this session, then Continue recording", () => {
    mocks.phase = "saved";
    mocks.recording = part(2);
    mocks.scope = { kind: "recording", sessionId: session, rows: [part(1), mocks.recording] };
    const html = render({ backHref: `/sessions/${session}` });
    expect(html).toContain("Saved on this device");
    expect(html).toContain(
      "This session stays open. Record more, or process it when the class is over.",
    );
    const process = html.match(/<button[^>]*>Process this session<\/button>/)?.[0] ?? "";
    const next = html.match(/<button[^>]*>Continue recording<\/button>/)?.[0] ?? "";
    expect(process).toContain("btn-primary");
    expect(next).toContain("btn-secondary");
    expect(html.indexOf("Process this session")).toBeLessThan(html.indexOf("Continue recording"));
    // Its parts are not on the server yet, so Process waits with the sync status.
    expect(process).toContain("disabled");
    expect(html).toContain("Back to session");
  });

  it("enables Process this session once every part of the session is on the server", () => {
    mocks.phase = "saved";
    mocks.recording = part(2, { sourceAssetId: "b" });
    mocks.scope = {
      kind: "recording",
      sessionId: session,
      rows: [part(1, { sourceAssetId: "a" }), mocks.recording],
    };
    const process = render().match(/<button[^>]*>Process this session<\/button>/)?.[0] ?? "";
    expect(process).not.toContain("disabled");
  });

  it("does not offer Process this session again for material already asked for (D105)", () => {
    mocks.phase = "saved";
    mocks.recording = part(1, { sourceAssetId: "a" });
    mocks.scope = { kind: "recording", sessionId: session, rows: [mocks.recording] };
    mocks.learning = { processRequest: "requested", revision: 3, requestedRevision: 3 };
    let html = render();
    expect(html).not.toContain(">Process this session<");
    expect(html).toContain(">Continue recording<");
    mocks.learning = { processRequest: "new_material", revision: 4, requestedRevision: 3 };
    html = render();
    expect(html).toContain(">Process this session<");
  });

  it("reads the listed session's status, not that of a recording of another session", () => {
    const other = "20000000-0000-4000-8000-000000000009";
    mocks.phase = "saved";
    // This tab's last recording belongs to another session, already asked for there.
    mocks.recording = part(1, { sessionId: other, sourceAssetId: "t" });
    mocks.learning = { processRequest: "requested", revision: 3, requestedRevision: 3 };
    mocks.learningSession = other;
    mocks.scope = {
      kind: "session",
      sessionId: session,
      rows: [part(2, { captureId: part(2).id, sourceAssetId: "s" })],
    };
    const html = render({ sessionId: session });
    const process = html.match(/<button[^>]*>Process this session<\/button>/)?.[0] ?? "";
    expect(process).not.toBe("");
    expect(process).not.toContain("disabled");
  });

  it("gives every finished part small controls named by its line", () => {
    mocks.phase = "saved";
    mocks.recording = part(1);
    mocks.scope = { kind: "recording", sessionId: session, rows: [mocks.recording] };
    const html = render();
    const title = html.match(/<strong id="([^"]+)"[^>]*>Part 1 · 1:01<\/strong>/);
    expect(title).not.toBeNull();
    for (const control of ["Listen", "Export audio", "Remove from this device"]) {
      const button = html.match(new RegExp(`<button[^>]*aria-label="${control}"[^>]*>`))?.[0];
      expect(button).toContain(`aria-describedby="${title?.[1]}"`);
      expect(button).toContain("btn-icon");
    }
    // One part, one "Saved on this device" in the list (the panel title is the other).
    expect(html.match(/Saved on this device/g)).toHaveLength(2);
  });

  it("lists the device's recordings on /recordings without a recording, grouped by date", () => {
    mocks.scope = {
      kind: "device",
      sessionId: null,
      rows: [part(1, { sessionId: null })],
    };
    const html = render({ sessionId: null });
    expect(html).toContain("Saved and recoverable recordings");
    expect(html).toContain("Part 1 · 1:01");
    expect(html).toMatch(/<h3>\d+ Oct, \d\d:\d\d<\/h3>/);
    expect(html).not.toContain("Process this session");
  });

  it("keeps the introduction and the empty device list when nothing was recorded", () => {
    const html = render({ sessionId: null });
    expect(html).toContain("your notes are made when you process this session");
    expect(html).toContain("No recordings on this device yet.");
  });
});

// D103 (owner decision 2026-10-20): the photo button offers the camera and the gallery, and
// several photos can be chosen at once.
describe("the photo picker", () => {
  it("does not force the camera and accepts several photos", () => {
    const input = render().match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(input).toContain("multiple");
    expect(input).not.toContain("capture");
  });
});
