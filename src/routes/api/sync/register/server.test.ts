import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnstileResult } from '$lib/server/turnstile';

const mocks = vi.hoisted(() => ({
	createAccount: vi.fn(async () => true),
	verifyRegistration: vi.fn(() => true),
	verifyTurnstile: vi.fn(
		async (_token: unknown, _action: string, _ip: string): Promise<TurnstileResult> => 'verified'
	)
}));

vi.mock('$lib/server/syncStore', () => ({
	getSyncStore: () => ({ createAccount: mocks.createAccount })
}));
vi.mock('$lib/server/syncAuth', () => ({ verifySyncRegistration: mocks.verifyRegistration }));
vi.mock('$lib/server/turnstile', () => ({ verifyTurnstile: mocks.verifyTurnstile }));
vi.mock('$lib/server/rateLimit', () => ({
	clientAddress: () => '203.0.113.1',
	getPublicApiLimiter: () => ({ check: async () => ({ allowed: true }) }),
	rateLimitResponse: () => new Response(null, { status: 429 })
}));

import { POST } from './+server';

const validBody = {
	accountId: 'account-123456789',
	authPublicKey: 'public-key',
	signature: 'signature',
	turnstileToken: 'turnstile-token'
};

async function post(body: unknown): Promise<Response> {
	return (
		POST as unknown as (event: {
			request: Request;
			getClientAddress(): string;
		}) => Promise<Response>
	)({
		request: new Request('http://localhost/api/sync/register', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => '203.0.113.1'
	});
}

describe('POST /api/sync/register', () => {
	beforeEach(() => {
		mocks.createAccount.mockClear();
		mocks.verifyRegistration.mockReset().mockReturnValue(true);
		mocks.verifyTurnstile.mockReset().mockResolvedValue('verified');
	});

	it('creates the account after verifying the register action', async () => {
		const response = await post(validBody);

		expect(response.status).toBe(200);
		expect(mocks.verifyTurnstile).toHaveBeenCalledWith(
			'turnstile-token',
			'register',
			'203.0.113.1'
		);
		expect(mocks.createAccount).toHaveBeenCalledWith('account-123456789', 'public-key');
	});

	it('creates the account when Turnstile is disabled', async () => {
		mocks.verifyTurnstile.mockResolvedValue('disabled');
		const response = await post({ ...validBody, turnstileToken: undefined });
		expect(response.status).toBe(200);
		expect(mocks.createAccount).toHaveBeenCalledTimes(1);
	});

	it('does not create the account when verification is rejected', async () => {
		mocks.verifyTurnstile.mockResolvedValue('rejected');
		const response = await post(validBody);
		expect(response.status).toBe(403);
		expect(mocks.createAccount).not.toHaveBeenCalled();
	});

	it('fails closed on incomplete Turnstile configuration', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mocks.verifyTurnstile.mockResolvedValue('misconfigured');
		const response = await post(validBody);
		expect(response.status).toBe(503);
		expect(mocks.createAccount).not.toHaveBeenCalled();
	});

	it('rejects an invalid signature before spending a siteverify call', async () => {
		mocks.verifyRegistration.mockReturnValue(false);
		const response = await post(validBody);
		expect(response.status).toBe(400);
		expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
	});
});
