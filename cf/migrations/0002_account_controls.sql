-- Per-account request-rate override alongside the byte quota that already exists.

CREATE TABLE account_rate_limits (
	account_id TEXT PRIMARY KEY,
	sync_per_minute INTEGER NOT NULL CHECK(sync_per_minute > 0),
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);
