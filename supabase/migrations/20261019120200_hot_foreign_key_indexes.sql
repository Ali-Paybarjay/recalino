-- PERF-07 (audit 2026-10-18): the composite foreign keys on the privacy-cleanup cascade paths get
-- an index that matches them exactly (Supabase advisor: unindexed_foreign_keys). Privacy cleanup
-- deletes tombstoned cards, which cascades to their review events, the undo of each event and the
-- card revisions; deleting a class cascades to its card links; deleting a notebook to its
-- revisions. Each table already had an index led by the first key column, so lookups were not
-- full scans; these indexes make the cascade and the key check use one exact index. The unused
-- indexes the advisor lists stay. No data changes.
create index review_event_card_owner_idx on srs.review_event (card_id, user_id);
create index review_undo_event_owner_idx on srs.review_undo (review_event_id, user_id);
create index card_revision_card_owner_idx on card.revision (card_id, user_id);
create index card_session_link_session_owner_idx on card.session_link (session_id, user_id);
create index note_revision_notebook_owner_idx on note.revision (notebook_id, user_id);
