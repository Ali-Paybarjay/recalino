-- PRD-DEL-01: NOTE privacy cleanup can remove old source-bearing revisions while
-- preserving a replacement notebook. Revisions remain append-only for normal edits.
grant delete on note.revision to recalino_app;
