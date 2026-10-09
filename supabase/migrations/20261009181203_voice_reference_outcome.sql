-- What a manual confirmation taught later matching, and why an automatic check asked. Not backfilled.
alter table voc.analysis
  add column reference_status text
    check (reference_status in ('added','short','expired','missing','mismatch')),
  add column match_reason text
    check (match_reason in ('policy_unavailable','no_sample','no_reference','few_voices','no_clear_match','similar_voices'));
-- An outcome belongs only to a current manual confirmation; reject, revoke and none clear it.
alter table voc.analysis add constraint analysis_reference_status_manual_check
  check (reference_status is null or (status = 'verified' and verification_method = 'manual'));
