-- E105 (option A, closes the E95 debt of RR-32 / R-24): PLT depends on no other module in the
-- capability map, so its tables must not hold an FK into ACC. Only the two constraints go; user_id
-- stays a plain uuid, like the other PLT tables, and no row, column, index or grant changes.
-- Account deletion does not need the old cascade: the `plt` privacy hook clears both tables
-- explicitly, and the auth identity is soft-deleted, so acc.user_account rows are not removed.
-- `if exists` keeps a repeated run a no-op.
alter table plt.notification drop constraint if exists notification_user_id_fkey;
alter table plt.push_subscription drop constraint if exists push_subscription_user_id_fkey;
