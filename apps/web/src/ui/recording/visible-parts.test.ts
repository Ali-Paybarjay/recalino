import { describe, expect, it } from "vitest";
import type { LocalPhoto, Recording } from "./store";
import { partScope, partsSync, recordingGroups, sessionMaterialSent } from "./visible-parts";

const userId = "10000000-0000-4000-8000-000000000002";
let next = 0;
function part(patch: Partial<Recording> = {}): Recording {
  next += 1;
  const id = `10000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
  return {
    id,
    userId,
    sessionId: null,
    captureId: id,
    segment: 1,
    creationKey: id,
    sourceAssetId: null,
    autoRegister: true,
    autoGenerate: true,
    mimeType: "audio/webm",
    status: "saved",
    activeMs: 1000,
    chunks: 1,
    bytes: 5,
    completedAt: "2026-10-20T10:00:00.000Z",
    createdAt: `2026-10-20T09:${String(next).padStart(2, "0")}:00.000Z`,
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...patch,
  };
}
const photo = (recordingId: string, sourceAssetId: string | null = null): LocalPhoto => ({
  id: `photo-${recordingId}-${sourceAssetId ?? "local"}`,
  userId,
  recordingId,
  offsetMs: 0,
  captureState: "recording",
  blob: new Blob(["x"]),
  createdAt: "2026-10-20T10:00:00.000Z",
  sourceAssetId,
});

// D107 (owner decision 2026-10-20): the recording page lists only this session's files.
describe("which parts the recording page lists", () => {
  const session = "20000000-0000-4000-8000-000000000001";
  const other = "20000000-0000-4000-8000-000000000002";
  const yesterday = part({ sessionId: other, createdAt: "2026-10-19T09:00:00.000Z" });
  const earlier = part({ sessionId: session });
  const first = part({ sessionId: null });
  const second = part({
    sessionId: null,
    captureId: first.id,
    creationKey: first.creationKey,
    segment: 2,
  });

  it("lists a Today recording without a session yet by its capture, never other days", () => {
    const scope = partScope([second, yesterday, first], first);
    expect(scope.kind).toBe("recording");
    expect(scope.rows.map((row) => row.id)).toEqual([first.id, second.id]);
  });

  it("adds the session's earlier recordings once the session is known, Part 1 on top", () => {
    const attached = [first, second].map((row) => ({ ...row, sessionId: session }));
    const scope = partScope([...attached.reverse(), yesterday, earlier], attached[0] ?? null);
    expect(scope.sessionId).toBe(session);
    expect(scope.rows.map((row) => row.id)).toEqual([earlier.id, first.id, second.id]);
  });

  it("keeps the earlier recordings of a Continue recording whose session is not known yet", () => {
    // Continue recording follows with the same class key, so both join the same session.
    const continued = part({ sessionId: null, creationKey: first.creationKey });
    const unrelated = part({ sessionId: null });
    const scope = partScope([continued, unrelated, yesterday, second, first], continued);
    expect(scope.rows.map((row) => row.id)).toEqual([first.id, second.id, continued.id]);
    // The new recording joined the session first; the earlier one is attached by the sync later.
    const attached = { ...continued, sessionId: session };
    expect(
      partScope([attached, unrelated, second, first, earlier], attached).rows.map((row) => row.id),
    ).toEqual([earlier.id, first.id, second.id, attached.id]);
    // A row with the same key in another session is not this recording's.
    const elsewhere = { ...first, sessionId: other };
    expect(partScope([elsewhere, attached], attached).rows.map((row) => row.id)).toEqual([
      attached.id,
    ]);
  });

  it("keeps a session page to its own session, even with another session's recording", () => {
    const current = { ...first, sessionId: other };
    const scope = partScope([current, yesterday, earlier], current, session);
    expect(scope).toMatchObject({ kind: "session", sessionId: session });
    expect(scope.rows.map((row) => row.id)).toEqual([earlier.id]);
    expect(partScope([yesterday, earlier], null, session).rows.map((row) => row.id)).toEqual([
      earlier.id,
    ]);
  });

  it("shows every recording of the device only on /recordings without a recording", () => {
    const scope = partScope([earlier, yesterday, second, first], null);
    expect(scope.kind).toBe("device");
    expect(scope.rows).toHaveLength(4);
    // One group per recording, newest first, parts in order within it.
    expect(recordingGroups(scope.rows).map((group) => group.parts.map((row) => row.id))).toEqual([
      [first.id, second.id],
      [earlier.id],
      [yesterday.id],
    ]);
  });
});

describe("the sync line and Process this session for the listed parts", () => {
  const session = "20000000-0000-4000-8000-000000000003";
  it("counts only the listed parts", () => {
    const rows = [
      part({ sessionId: session, sourceAssetId: "a" }),
      part({ sessionId: session }),
      part({ sessionId: session, completedAt: undefined, status: "recording" }),
      part({ sessionId: session, bytes: 0 }),
    ];
    expect(partsSync(rows)).toEqual({ added: 1, pending: 1 });
  });

  it("waits until every part and board photo of the session is on the server", () => {
    const sent = part({ sessionId: session, sourceAssetId: "a" });
    expect(sessionMaterialSent([sent], [photo(sent.id, "p")], session)).toBe(true);
    expect(sessionMaterialSent([sent], [photo(sent.id)], session)).toBe(false);
    expect(sessionMaterialSent([sent, part({ sessionId: session })], [], session)).toBe(false);
    expect(
      sessionMaterialSent(
        [sent, part({ sessionId: session, completedAt: undefined })],
        [],
        session,
      ),
    ).toBe(false);
    // A part of the recording whose session is not attached yet is not sent either.
    expect(sessionMaterialSent([sent, part()], [], session)).toBe(false);
    // An empty part has nothing to send; another recording's photo is not this session's.
    expect(sessionMaterialSent([sent, part({ bytes: 0 })], [photo("elsewhere")], session)).toBe(
      true,
    );
    expect(sessionMaterialSent([sent], [], null)).toBe(false);
  });
});
