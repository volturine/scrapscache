CREATE TABLE IF NOT EXISTS reminder_history (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 note TEXT NOT NULL,
 deleted INTEGER NOT NULL DEFAULT 0,
 ciphertext TEXT NOT NULL,
 UNIQUE(account_id, id)
);
CREATE INDEX IF NOT EXISTS reminder_history_account_seq ON reminder_history(account_id, seq);
CREATE INDEX IF NOT EXISTS reminder_history_note ON reminder_history(account_id, note, deleted);
