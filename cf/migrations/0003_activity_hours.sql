-- Hourly operational counters for the operator dashboard. Aggregates only: a key
-- names what happened (a sync batch, a wake result, a server error on a route
-- bucket), never who it happened to.
CREATE TABLE activity_hours (
	hour INTEGER NOT NULL,
	key TEXT NOT NULL,
	value REAL NOT NULL,
	PRIMARY KEY (hour, key)
);
