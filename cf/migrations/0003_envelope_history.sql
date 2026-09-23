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
CREATE INDEX envelope_history_account_time ON envelope_history(account_id, history_id DESC);
CREATE INDEX envelope_history_saved_at ON envelope_history(saved_at);
