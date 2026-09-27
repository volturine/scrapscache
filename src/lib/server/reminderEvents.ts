import { ReminderEventChannel } from './reminderEventStream';

const channels = new Map<string, ReminderEventChannel>();
export async function openReminderEvents(
	accountId: string,
	signal?: AbortSignal
): Promise<Response> {
	let channel = channels.get(accountId);
	if (!channel) {
		channel = new ReminderEventChannel(() => channels.delete(accountId));
		channels.set(accountId, channel);
	}
	return channel.stream(signal);
}
export async function notifyReminderEvents(accountId: string): Promise<void> {
	channels.get(accountId)?.notify();
}
