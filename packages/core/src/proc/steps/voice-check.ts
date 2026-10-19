// The acoustic check run beside lesson generation (audit QUA-01). Moved verbatim from worker.ts.

/**
 * The acoustic check of a run's audio, started while the lesson is generated. The native engine
 * runs in a worker thread, so the check and the provider calls do not wait for each other.
 */
export function startVoiceCheck(run: () => Promise<boolean>) {
  let running = true;
  const result = run().then(
    (analyzed) => ({ analyzed }),
    (error: unknown) => ({ error }),
  );
  void result.finally(() => {
    running = false;
  });
  return {
    running: () => running,
    /** True when the check saved an analysis in this job; rethrows the check's failure. */
    async wait(): Promise<boolean> {
      const outcome = await result;
      if ("error" in outcome) throw outcome.error;
      return outcome.analyzed;
    },
    /** Waits without rethrowing, when the job already fails for another reason. */
    async settle(): Promise<void> {
      await result;
    },
  };
}
