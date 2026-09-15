-- Account ids whose owner deleted them. Deleting cloud data retires the sync key
-- for good, so a device that still holds it, such as a lost one, can never
-- register it again and read what another device would upload there. No foreign
-- key: the row has to outlive the account it names.
CREATE TABLE retired_accounts (
	account_id TEXT PRIMARY KEY,
	retired_at INTEGER NOT NULL
);
