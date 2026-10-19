import { describe, expect, it } from "vitest";
import {
  backupStaleness,
  backupsToExpire,
  DEFAULT_BACKUP_RETENTION,
  readBackupRetentionSettings,
  retainedReadyBackupIds,
} from "./backups";

const hour = 3600 * 1000;
const day = 24 * hour;
const now = new Date("2026-11-20T12:00:00Z");
function row(id: string, state: string, ageDays: number) {
  const createdAt = new Date(now.getTime() - ageDays * day);
  return { id, state, createdAt, expiresAt: new Date(createdAt.getTime() + 30 * day) };
}

// OPS-01: a run of failed nightly backups must never let retention delete the last good copies.
describe("backup retention floor", () => {
  const rows = [
    row("r1", "ready", 40),
    row("r2", "ready", 36),
    row("r3", "ready", 35),
    row("r4", "ready", 34),
    row("f1", "failed", 33),
    row("p1", "pending", 32),
    row("d1", "deleted", 45),
  ];

  it("keeps the newest three ready backups even after all of them expired", () => {
    expect(retainedReadyBackupIds(rows, 3)).toEqual(["r4", "r3", "r2"]);
    expect(backupsToExpire(rows, now, 3)).toEqual(["r1", "f1", "p1"]);
  });

  it("expires every lapsed backup when the floor is zero (strict 30-day lifecycle)", () => {
    expect(backupsToExpire(rows, now, 0)).toEqual(["r1", "r2", "r3", "r4", "f1", "p1"]);
  });

  it("never expires a backup inside its 30 days", () => {
    expect(backupsToExpire([row("new", "ready", 1), row("old", "failed", 2)], now, 0)).toEqual([]);
  });

  it("breaks creation-time ties by id, like the SQL order", () => {
    const tied = [row("a", "ready", 40), row("c", "ready", 40), row("b", "ready", 40)];
    expect(retainedReadyBackupIds(tied, 2)).toEqual(["c", "b"]);
  });
});

describe("backup staleness", () => {
  it("is fresh while the newest ready backup is inside the threshold", () => {
    expect(
      backupStaleness({ id: "r", createdAt: new Date(now.getTime() - 29 * hour) }, now, 30),
    ).toEqual({ stale: false });
  });

  it("is stale past the threshold and names the backup it is measured from", () => {
    expect(
      backupStaleness({ id: "r", createdAt: new Date(now.getTime() - 31 * hour) }, now, 30),
    ).toEqual({ stale: true, subjectId: "r", ageMs: 31 * hour });
  });

  it("is stale when no ready backup exists at all", () => {
    expect(backupStaleness(null, now, 30)).toEqual({ stale: true, subjectId: "none", ageMs: null });
  });
});

describe("backup retention settings", () => {
  it("defaults to three kept copies and a 30-hour alert", () => {
    expect(readBackupRetentionSettings({})).toEqual(DEFAULT_BACKUP_RETENTION);
    expect(DEFAULT_BACKUP_RETENTION).toEqual({ keepReady: 3, staleAfterHours: 30 });
  });

  it("accepts a partial override without code changes", () => {
    expect(
      readBackupRetentionSettings({ RECALINO_BACKUP_RETENTION_JSON: '{"keepReady":5}' }),
    ).toEqual({ keepReady: 5, staleAfterHours: 30 });
  });

  it.each(['{"keepReady":-1}', '{"staleAfterHours":0}', '{"extra":1}', "not json"])(
    "rejects the invalid override %s by name only",
    (raw) => {
      expect(() => readBackupRetentionSettings({ RECALINO_BACKUP_RETENTION_JSON: raw })).toThrow(
        /^Invalid RECALINO_BACKUP_RETENTION_JSON/,
      );
    },
  );
});
