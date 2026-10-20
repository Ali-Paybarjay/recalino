/**
 * D107: the highest part number this device has given to a session's recordings, or to the
 * recordings that share a class key before their session is known. "Remove from this device"
 * deletes a part's audio, never its number, so the next recording of the session goes on after
 * it, as the server's material names do ("Session recording … · Part N").
 *
 * Kept in site storage beside the recordings, numbers only. Best effort: where site storage is
 * unavailable, the numbers come from the parts still on this device, as before. Account deletion
 * removes them with the account's other device data (PrivacyView, `recalino:learning-` prefix).
 */
export interface PartNumbers {
  highest(userId: string, keys: readonly (string | null | undefined)[]): number;
  raise(userId: string, keys: readonly (string | null | undefined)[], part: number): void;
}

export const PART_NUMBERS_PREFIX = "recalino:learning-parts:";
const storageKey = (userId: string, key: string) => `${PART_NUMBERS_PREFIX}${userId}:${key}`;

function read(userId: string, key: string) {
  try {
    const value = Number(localStorage.getItem(storageKey(userId, key)));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export const devicePartNumbers: PartNumbers = {
  highest(userId, keys) {
    return keys.reduce<number>(
      (highest, key) => (key ? Math.max(highest, read(userId, key)) : highest),
      0,
    );
  },
  raise(userId, keys, part) {
    for (const key of keys) {
      if (!key || read(userId, key) >= part) continue;
      try {
        localStorage.setItem(storageKey(userId, key), String(part));
      } catch {
        /* The parts on this device still number the next recording. */
      }
    }
  },
};
