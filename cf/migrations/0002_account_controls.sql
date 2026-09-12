-- Per-account operator controls: a request-rate override alongside the byte
-- quota that already exists, and feature gating so unreleased work can be turned
-- on for specific accounts before anyone else sees it.

CREATE TABLE account_rate_limits (
	account_id TEXT PRIMARY KEY,
	sync_per_minute INTEGER NOT NULL CHECK(sync_per_minute > 0),
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

-- The set of gates that exist at all, and what an account gets when it has no
-- opinion recorded. A flag absent from here is off for everyone, so removing a
-- row is how a finished rollout is cleaned up.
CREATE TABLE feature_flags (
	flag TEXT PRIMARY KEY,
	default_enabled INTEGER NOT NULL DEFAULT 0,
	description TEXT NOT NULL DEFAULT '',
	updated_at INTEGER NOT NULL
);

-- Per-account overrides of the default above, in both directions: an early
-- tester turned on, or one account opted out of something already rolled out.
CREATE TABLE account_feature_flags (
	account_id TEXT NOT NULL,
	flag TEXT NOT NULL,
	enabled INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (account_id, flag),
	FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);
CREATE INDEX account_feature_flags_flag ON account_feature_flags(flag);
