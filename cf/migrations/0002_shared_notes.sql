CREATE TABLE IF NOT EXISTS shared_notes (
	id TEXT PRIMARY KEY,
	ciphertext TEXT NOT NULL,
	burn_after_reading INTEGER NOT NULL DEFAULT 0,
	view_count INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shared_notes_expires ON shared_notes(expires_at);
