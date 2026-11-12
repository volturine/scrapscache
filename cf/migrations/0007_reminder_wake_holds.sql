-- The wakes an iPhone app shows by itself, as it last named them: the relay sends
-- that phone every other wake. Replaced whole each time the phone registers, so a
-- device holds no more rows than a phone can schedule.
CREATE TABLE reminder_wake_holds (
	account_id TEXT NOT NULL,
	device_id TEXT NOT NULL,
	wake_id TEXT NOT NULL,
	PRIMARY KEY (account_id, device_id, wake_id)
);
