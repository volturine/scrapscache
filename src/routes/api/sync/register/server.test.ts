import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnstileResult } from '#lib/server/turnstile.js';
import type { RateLimitResult } from '#lib/server/rateLimit.js';

const mocks = vi.hoisted(() => ({
	chargeGlobal: vi.fn(async (): Promise<RateLimitResult> => ({ allowed: true })),
	createAccount: vi.fn(async () => true),
	isAccountRetired: vi.fn(async () => false),
	verifyRegistration: vi.fn(() => true),
	verifyTurnstile: vi.fn(
		async (_token: unknown, _action: string, _ip: string): Promise<TurnstileResult> => 'verified'
	)
}));

vi.mock('#lib/server/syncStore.js', () => ({
	getSyncStore: () => ({
		createAccount: mocks.createAccount,
		isAccountRetired: mocks.isAccountRetired
	})
}));
vi.mock('#lib/server/syncAuth.js', () => ({ verifySyncRegistration: mocks.verifyRegistration }));
vi.mock('#lib/server/turnstile.js', () => ({ verifyTurnstile: mocks.verifyTurnstile }));
vi.mock('#lib/server/rateLimit.js', () => ({
	clientAddress: () => '203.0.113.1',
	checkRegisterLimit: async () => ({ allowed: true }),
	chargeRegisterGlobalLimit: mocks.chargeGlobal,
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
		mocks.chargeGlobal.mockClear();
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

	it('tells a device its key was retired, distinct from an account that exists', async () => {
		mocks.createAccount.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
		mocks.isAccountRetired.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

		const retired = await post(validBody);
		expect(retired.status).toBe(410);
		expect(await retired.json()).toMatchObject({ retired: true });

		expect((await post(validBody)).status).toBe(409);
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

	it("spends everyone's allowance only on a request that proved itself", async () => {
		mocks.verifyRegistration.mockReturnValue(false);
		expect((await post(validBody)).status).toBe(400);
		mocks.verifyRegistration.mockReturnValue(true);
		mocks.verifyTurnstile.mockResolvedValue('rejected');
		expect((await post(validBody)).status).toBe(403);
		expect(mocks.chargeGlobal).not.toHaveBeenCalled();

		mocks.verifyTurnstile.mockResolvedValue('verified');
		mocks.chargeGlobal.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 6 });
		expect((await post(validBody)).status).toBe(429);
		expect(mocks.createAccount).not.toHaveBeenCalled();
	});
});
