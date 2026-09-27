import { cloudflareBindings } from './env';

function scheduler(accountId: string) {
	const namespace = cloudflareBindings().REMINDER_SCHEDULER;
	return namespace.get(namespace.idFromName(accountId));
}
export async function openReminderEvents(
	accountId: string,
	signal?: AbortSignal
): Promise<Response> {
	const response = await scheduler(accountId).fetch('https://reminder-scheduler/events', {
		signal: signal as unknown as import('@cloudflare/workers-types').AbortSignal
	});
	// Own the headers: the app's hooks add security headers to the response.
	return new Response(response.body as unknown as BodyInit | null, {
		status: response.status,
		headers: new Headers(response.headers as unknown as HeadersInit)
	});
}
export async function notifyReminderEvents(accountId: string): Promise<void> {
	const response = await scheduler(accountId).fetch('https://reminder-scheduler/notify', {
		method: 'POST'
	});
	if (!response.ok) throw new Error('Reminder event notification failed');
}
