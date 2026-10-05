-- Forecasts are snapshotted before dispatch. They never change the independent spending hold.
alter table proc.provider_attempt add column estimate_rates jsonb;
alter table proc.provider_attempt add column estimate_price_version text;
