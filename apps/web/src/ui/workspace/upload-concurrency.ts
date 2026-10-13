/** Wait for in-flight siblings before exposing failure; never leave late writes after retry. */
export async function concurrentUploads<T>(
  items: readonly T[],
  limit: number,
  effect: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid upload concurrency");
  let next = 0;
  let failure: unknown;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed && next < items.length) {
        const item = items[next++] as T;
        try {
          await effect(item);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }),
  );
  if (failed) throw failure;
}

/**
 * A shared limit for work started from several concurrent loops, e.g. the parts of audio files
 * transferred side by side: at most `limit` effects run at once across every caller.
 */
export function uploadSlots(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid upload concurrency");
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function slot<T>(effect: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await effect();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
