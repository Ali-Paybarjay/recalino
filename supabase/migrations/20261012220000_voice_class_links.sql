-- Workstream 4 (2026-10-12). One speaker namespace per class (PRD-SPK-02): each part analysis
-- stores which class voice its speakers were linked to across the class's recording parts, and
-- the learner's own line-level choices (draft FR-VOC v3, behind a switch). Neither holds a
-- voiceprint; both are deleted with the analysis on revocation, source or session deletion.
alter table voc.analysis
  add column speaker_links jsonb not null default '{}'
    check (jsonb_typeof(speaker_links) = 'object'),
  add column line_choices jsonb not null default '{}'
    check (jsonb_typeof(line_choices) = 'object');
