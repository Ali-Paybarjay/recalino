alter table src.audio_upload add column actual_duration_ms bigint check(actual_duration_ms > 0);
