-- Per-account request-rate override alongside the byte quota that already exists.

CREATE TABLE account_rate_limits (
	account_id TEXT PRIMARY KEY,
	sync_per_minute INTEGER NOT NULL CHECK(sync_per_minute > 0),
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

-- Hourly operational counters for the operator dashboard. Aggregates only: a key
-- names what happened (a sync batch, a wake result, a server error on a route
-- bucket), never who it happened to.
CREATE TABLE activity_hours (
	hour INTEGER NOT NULL,
	key TEXT NOT NULL,
	value REAL NOT NULL,
	PRIMARY KEY (hour, key)
);

-- Account ids whose owner deleted them. Deleting cloud data retires the sync key
-- for good, so a device that still holds it, such as a lost one, can never
-- register it again and read what another device would upload there. No foreign
-- key: the row has to outlive the account it names.
CREATE TABLE retired_accounts (
	account_id TEXT PRIMARY KEY,
	retired_at INTEGER NOT NULL
);
