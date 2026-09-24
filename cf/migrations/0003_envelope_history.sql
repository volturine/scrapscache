CREATE TABLE envelope_history (
	history_id INTEGER PRIMARY KEY AUTOINCREMENT,
	account_id TEXT NOT NULL,
	slot TEXT NOT NULL,
	id TEXT NOT NULL,
	r2_key TEXT NOT NULL,
	ciphertext_bytes INTEGER NOT NULL,
	saved_at INTEGER NOT NULL,
	FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);
CREATE INDEX envelope_history_slot ON envelope_history(account_id, slot, history_id DESC);
CREATE INDEX envelope_history_id ON envelope_history(account_id, id);
CREATE INDEX envelope_history_r2_key ON envelope_history(r2_key);
-- Reference checks before deleting an object look it up within its account.
CREATE INDEX envelopes_r2_key ON envelopes(account_id, r2_key);
CREATE INDEX deleted_envelopes_r2_key ON deleted_envelopes(account_id, r2_key);
-- Older versions (not the live copy each record's history also holds), counted in quota.
CREATE TABLE account_history_usage (
	account_id TEXT PRIMARY KEY,
	versions INTEGER NOT NULL DEFAULT 0,
	bytes INTEGER NOT NULL DEFAULT 0,
	FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);
