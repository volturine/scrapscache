// The reminders Worker: scheduling only. Each synced account has one
// ReminderScheduler, which holds an alarm for that account's next reminder wake
// and nothing else. When the alarm fires, it puts the account on the wake queue;
// the app Worker consumes it, delivers the account's due wakes, and sets the next
// alarm. Sending stays in the app Worker, which holds the database and push keys.
//
// Bindings run one way only (app -> schedulers, schedulers -> queue -> app), so
// each Worker can be deployed without the other deployed first.
// The entry module may export only handlers and Durable Object classes; a
// constant here stops the Worker from starting.
export { ReminderScheduler } from './reminderScheduler';

/** The Worker serves nothing itself; the app reaches the schedulers through its binding. */
export default {
	fetch(): Response {
		return new Response('Not found', { status: 404 });
	}
};
