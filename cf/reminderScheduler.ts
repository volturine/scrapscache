// One account's reminder alarm. Kept apart from the Worker entry module, which
// may export only handlers and Durable Object classes.
import type { DurableObjectState, Queue } from '@cloudflare/workers-types';

type Env = {
	WAKE_QUEUE: Queue<{ accountId: string }>;
};

const ACCOUNT_KEY = 'accountId';
const GENERATION_KEY = 'generation';
/**
 * Handing an account to the app also sets this retry. Delivering replaces it with
 * the account's next wake; if the app could not deliver, the account comes round
 * again instead of waiting for its next change.
 */
export const RETRY_AFTER_MS = 10 * 60_000;

export class ReminderScheduler {
	constructor(
		private readonly state: DurableObjectState,
		private readonly env: Env
	) {}

	/**
	 * `POST /arm { accountId, at }`: run no later than `at`.
	 * `POST /begin { accountId }`: start a delivery generation.
	 * `POST /set { accountId, at, generation }`: finish only that generation.
	 */
	async fetch(request: Request): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (request.method !== 'POST' || (path !== '/arm' && path !== '/set' && path !== '/begin')) {
			return Response.json({ error: 'Not found' }, { status: 404 });
		}
		const { accountId, at, generation } = (await request.json().catch(() => ({}))) as {
			accountId?: unknown;
			at?: unknown;
			generation?: unknown;
		};
		if (typeof accountId !== 'string' || !accountId) {
			return Response.json({ error: 'An account id is required' }, { status: 400 });
		}
		return this.state.blockConcurrencyWhile(async () => {
			let currentGeneration = (await this.state.storage.get<number>(GENERATION_KEY)) ?? 0;
			if (path === '/begin') {
				await this.state.storage.put(GENERATION_KEY, ++currentGeneration);
				return Response.json({ generation: currentGeneration });
			}
			if (path === '/set' && generation !== currentGeneration)
				return new Response(null, { status: 204 });
			const time = typeof at === 'number' && Number.isSafeInteger(at) && at >= 0 ? at : null;
			if (time === null && (path === '/arm' || at !== null)) {
				return Response.json({ error: 'A wake time is required' }, { status: 400 });
			}
			// The object is named after the account; it keeps the id to act on at alarm time.
			await this.state.storage.put(ACCOUNT_KEY, accountId);
			if (path === '/arm') {
				await this.state.storage.put(GENERATION_KEY, ++currentGeneration);
				await this.armNoLaterThan(time as number);
			} else if (time === null) await this.state.storage.deleteAlarm();
			else await this.state.storage.setAlarm(time);
			return new Response(null, { status: 204 });
		});
	}

	async alarm(): Promise<void> {
		const accountId = await this.state.storage.get<string>(ACCOUNT_KEY);
		if (!accountId) return;
		// The retry is set first: the app may deliver and set the next alarm before
		// the send below returns, and a retry set after it would replace that.
		await this.state.storage.setAlarm(Date.now() + RETRY_AFTER_MS);
		await this.env.WAKE_QUEUE.send({ accountId });
	}

	private async armNoLaterThan(at: number): Promise<void> {
		const current = await this.state.storage.getAlarm();
		if (current != null && current <= at) return;
		await this.state.storage.setAlarm(at);
	}
}
