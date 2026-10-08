-- Forward repair for databases created before confirmed temporary audio uploads were added.
alter table proc.processing_run drop constraint processing_run_state_check;
alter table proc.processing_run add constraint processing_run_state_check
  check(state in ('awaiting_upload','queued','processing','needs_input','partial_ready','ready','failed','cancelled'));
drop index proc.one_active_processing_run_idx;
create unique index one_active_processing_run_idx on proc.processing_run(session_id)
  where state in ('awaiting_upload','queued','processing');
