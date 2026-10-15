-- D79: a learner starts with up to 20 new review cards per study day instead of 5. The code default
-- (DEFAULT_REVIEW_SETTINGS) applies until the learner saves review settings; saved choices are kept
-- and stay adjustable between 0 and 100. No data changes.
alter table srs.settings alter column daily_new_limit set default 20;
