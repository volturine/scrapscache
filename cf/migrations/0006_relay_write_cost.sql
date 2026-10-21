-- Older versions evicted for quota, per account. Clients cache which photos a note's
-- history still needs; this count changing tells them versions went without the note
-- itself changing.
CREATE TABLE account_history_evictions (
	account_id TEXT PRIMARY KEY,
	evicted INTEGER NOT NULL DEFAULT 0,
	FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

-- Wake changes not yet handed to the delivery scheduler, up to this revision. A failed
-- arm leaves the row, so the next publish arms again even with identical wakes.
CREATE TABLE reminder_wakes_unscheduled (
	account_id TEXT PRIMARY KEY,
	revision INTEGER NOT NULL
);

-- Every rate-limit check rewrites its bucket's last_seen_at, and this index doubled
-- the rows each check writes, refusals included. Only the hourly prune and the
-- throttled-caller count read by it, and both scan a table of recent callers.
DROP INDEX IF EXISTS rate_buckets_last_seen;
