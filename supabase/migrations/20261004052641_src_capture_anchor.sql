-- Device photo anchors are metadata, scoped to the class link and provisional until confirmed.
alter table src.session_source
  add column anchor_source_id uuid references src.asset(id),
  add column capture_offset_ms bigint check(capture_offset_ms >= 0),
  add column capture_state text check(capture_state in ('recording','paused')),
  add constraint source_capture_anchor_complete check (
    (anchor_source_id is null and capture_offset_ms is null and capture_state is null) or
    (anchor_source_id is not null and capture_offset_ms is not null and capture_state is not null)
  );
create index session_source_anchor_idx on src.session_source(anchor_source_id) where anchor_source_id is not null;
