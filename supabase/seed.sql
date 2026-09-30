-- Local development and CI only: seed.sql never runs against the cloud project.
-- Only synthetic data belongs here (assumption A5).

-- Local-only password for the application role; the cloud password is set by the owner (ADR-0002).
alter role recalino_app with password 'recalino-local-only';
