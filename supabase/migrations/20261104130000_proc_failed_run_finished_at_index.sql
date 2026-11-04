-- P2-02 (phase 2, follow-up of P1-09): the health check counts processing runs that ended in
-- 'failed' within a finished_at window (countFailedRuns, packages/core/src/proc/run-health.ts).
-- No index supported that count, so each health check scanned the whole table. This partial
-- index holds only failed runs, ordered by finished_at, so the count reads one index range.
-- Idempotent (if not exists); rows, columns and privileges stay as they are.
create index if not exists processing_run_failed_finished_at_idx
  on proc.processing_run (finished_at)
  where state = 'failed';
