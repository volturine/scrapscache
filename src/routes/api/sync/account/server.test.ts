import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	calls: [] as string[],
	authenticate: vi.fn(async (): Promise<string | null> => 'account-123456789'),
	retire: vi.fn(async () => undefined),
	remove: vi.fn(async () => true)
}));

vi.mock('$lib/server/syncStore', () => ({
	getSyncStore: () => ({
		retireAccount: async (id: string) => {
			mocks.calls.push(`retire ${id}`);
			return mocks.retire();
		},
		deleteAccount: async (id: string) => {
			mocks.calls.push(`delete ${id}`);
			return mocks.remove();
		}
	})
}));
vi.mock('$lib/server/syncAuth', () => ({
	getSyncAuth: () => ({
		authenticateSyncRequest: mocks.authenticate,
		revokeSyncSessions: async () => undefined
	})
}));
vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: () => '127.0.0.1',
	getPublicApiLimiter: () => ({ check: async () => ({ allowed: true }) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));

import { DELETE } from './+server';

async function remove(): Promise<Response> {
	return (
		DELETE as unknown as (event: {
			request: Request;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request('https://example.test/api/sync/account', { method: 'DELETE' }),
		getClientAddress: () => '127.0.0.1'
	});
}

describe('DELETE /api/sync/account', () => {
	beforeEach(() => {
		mocks.calls.length = 0;
		mocks.authenticate.mockReset().mockResolvedValue('account-123456789');
		mocks.retire.mockReset().mockResolvedValue(undefined);
	});

	it('retires the key before deleting its account', async () => {
		expect((await remove()).status).toBe(204);
		expect(mocks.calls).toEqual(['retire account-123456789', 'delete account-123456789']);
	});

	it('deletes nothing when the key could not be retired', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mocks.retire.mockRejectedValue(new Error('storage down'));

		expect((await remove()).status).toBe(503);
		expect(mocks.calls).toEqual(['retire account-123456789']);
	});

	it('refuses an unauthenticated caller', async () => {
		mocks.authenticate.mockResolvedValue(null);
		expect((await remove()).status).toBe(401);
		expect(mocks.calls).toEqual([]);
	});
});
