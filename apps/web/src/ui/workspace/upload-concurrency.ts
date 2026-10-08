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
