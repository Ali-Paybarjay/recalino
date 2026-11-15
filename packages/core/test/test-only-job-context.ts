/**
 * P11-02 AC-13 and AC-14 (E321, E322-R): the explicit test-only marker for a hand-made JobContext
 * that is not a claim. A JobContext without a lease is refused by every guarded write (fail-closed);
 * one carrying this marker keeps the earlier behaviour, so fixtures that drive a job by hand still
 * run. The marker is a symbol-keyed own property set only here: no env, flag, setting, payload or
 * other runtime value can produce it. Production reads it in exactly one place (see the static test
 * tools/test/test-only-job-context-marker.test.ts), and no production file imports this module.
 * Tests of a guarded path itself use a really claimed job with a real lease instead (AC-16).
 * A context spread from a marked one keeps the marker (own enumerable property).
 */
const TEST_ONLY_JOB_CONTEXT = Symbol.for("recalino.test-only-job-context");

/** Marks a hand-made test JobContext as test-only, in place, and returns the same object. */
export function testOnlyJobContext<T extends object>(job: T): T {
  Object.defineProperty(job, TEST_ONLY_JOB_CONTEXT, { value: true, enumerable: true });
  return job;
}
