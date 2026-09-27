CREATE TABLE IF NOT EXISTS reminder_receipts (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
 note TEXT NOT NULL,
 deleted INTEGER NOT NULL DEFAULT 0,
 ciphertext TEXT NOT NULL,
 UNIQUE(account_id, note)
);
CREATE INDEX IF NOT EXISTS reminder_receipts_account_seq ON reminder_receipts(account_id, seq);
