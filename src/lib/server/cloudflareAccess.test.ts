// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { privateEnv } from '../../tests/env';
import { passedCloudflareAccess } from './cloudflareAccess';

const AUDIENCE = 'a'.repeat(64);

let signingKey: CryptoKey;
let foreignKey: CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
	const pair = await generateKeyPair('RS256', { extractable: true });
	signingKey = pair.privateKey;
	publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'access-key', alg: 'RS256' };
	foreignKey = (await generateKeyPair('RS256')).privateKey;
});

/** Each test names its own team, so no key set cached by an earlier one is reused. */
function useTeam(team: string) {
	privateEnv.SCRAPSCACHE_ACCESS_TEAM_DOMAIN = `${team}.cloudflareaccess.com`;
	privateEnv.SCRAPSCACHE_ACCESS_AUD = AUDIENCE;
	const fetch = vi.fn(async (input: RequestInfo | URL) => {
		expect(String(input instanceof Request ? input.url : input)).toBe(
			`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`
		);
		return Response.json({ keys: [publicJwk] });
	});
	vi.stubGlobal('fetch', fetch);
	return { issuer: `https://${team}.cloudflareaccess.com`, fetch };
}

function token(
	issuer: string,
	options: { audience?: string; key?: CryptoKey; expiresAt?: number; kid?: string } = {}
): Promise<string> {
	return new SignJWT({ email: 'operator@example.test' })
		.setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'access-key' })
		.setIssuer(issuer)
		.setAudience(options.audience ?? AUDIENCE)
		.setIssuedAt()
		.setExpirationTime(options.expiresAt ?? '5m')
		.sign(options.key ?? signingKey);
}

function request(assertion?: string): Request {
	return new Request('https://admin.example.test/api/admin/status', {
		headers: assertion ? { 'cf-access-jwt-assertion': assertion } : {}
	});
}

describe('Cloudflare Access', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('admits a request Access signed for this application', async () => {
		const { issuer } = useTeam('admits');
		expect(await passedCloudflareAccess(request(await token(issuer)))).toBe(true);
	});

	it('refuses a token for another application, team, key or time', async () => {
		const { issuer } = useTeam('refuses');
		const refused = [
			await token(issuer, { audience: 'b'.repeat(64) }),
			await token('https://elsewhere.cloudflareaccess.com'),
			await token(issuer, { key: foreignKey }),
			await token(issuer, { expiresAt: Math.floor(Date.now() / 1000) - 60 }),
			`${(await token(issuer)).split('.').slice(0, 2).join('.')}.`
		];
		for (const assertion of refused)
			expect(await passedCloudflareAccess(request(assertion))).toBe(false);
	});

	it('trusts no header at all when Access is not configured', async () => {
		const { issuer, fetch } = useTeam('unconfigured');
		const assertion = await token(issuer);
		delete privateEnv.SCRAPSCACHE_ACCESS_TEAM_DOMAIN;
		delete privateEnv.SCRAPSCACHE_ACCESS_AUD;

		expect(await passedCloudflareAccess(request(assertion))).toBe(false);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses without a header, and without fetching keys', async () => {
		const { fetch } = useTeam('no-header');
		expect(await passedCloudflareAccess(request())).toBe(false);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('fails closed, and says so, when only half of Access is configured', async () => {
		const { issuer } = useTeam('half');
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		delete privateEnv.SCRAPSCACHE_ACCESS_AUD;

		expect(await passedCloudflareAccess(request(await token(issuer)))).toBe(false);
		expect(error.mock.calls[0]?.[0]).toContain('access_config_invalid');

		privateEnv.SCRAPSCACHE_ACCESS_AUD = AUDIENCE;
		privateEnv.SCRAPSCACHE_ACCESS_TEAM_DOMAIN = 'https://attacker.example';
		expect(await passedCloudflareAccess(request(await token('https://attacker.example')))).toBe(
			false
		);
	});

	it('logs when the team keys endpoint answers with an error', async () => {
		const { issuer } = useTeam('erroring');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('upstream down', { status: 503 }))
		);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(await passedCloudflareAccess(request(await token(issuer)))).toBe(false);
		expect(error.mock.calls[0]?.[0]).toContain('access_keys_unavailable');
	});

	it('logs nothing for a token that is merely wrong', async () => {
		const { issuer } = useTeam('quiet');
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(await passedCloudflareAccess(request(await token(issuer, { key: foreignKey })))).toBe(
			false
		);
		expect(error).not.toHaveBeenCalled();
	});

	it('stays quiet for a token naming a key the team does not have', async () => {
		const { issuer } = useTeam('unknown-kid');
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(await passedCloudflareAccess(request(await token(issuer, { kid: 'forged' })))).toBe(
			false
		);
		expect(error).not.toHaveBeenCalled();
	});

	it('logs once when the team publishes no keys at all', async () => {
		const { issuer } = useTeam('no-keys');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ keys: [] }))
		);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(await passedCloudflareAccess(request(await token(issuer)))).toBe(false);
		expect(await passedCloudflareAccess(request(await token(issuer)))).toBe(false);
		expect(error).toHaveBeenCalledOnce();
		expect(error.mock.calls[0][0]).toContain('access_keys_empty');
	});

	it('logs, rather than silently refusing, when the team keys cannot be fetched', async () => {
		const { issuer } = useTeam('unreachable');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('network down');
			})
		);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(await passedCloudflareAccess(request(await token(issuer)))).toBe(false);
		expect(error.mock.calls[0]?.[0]).toContain('access_keys_unavailable');
	});
});
