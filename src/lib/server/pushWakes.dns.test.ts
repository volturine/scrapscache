import { describe, expect, it, vi } from 'vitest';
import { isHttpsEndpoint, isPublicEndpoint } from './pushWakes';

const resolve = vi.fn<() => Promise<Array<{ address: string }>>>();

/**
 * Issue #87: literal-level checks cannot see DNS answers. Registration-time
 * validation must resolve the hostname and reject any private answer, on top
 * of the push-service host allowlist.
 */
describe('push endpoint resolution-time validation', () => {
	it('rejects private literals and hosts off the allowlist without a lookup', async () => {
		resolve.mockResolvedValue([{ address: '93.184.216.34' }]);
		expect(await isPublicEndpoint('https://127.0.0.1/push', resolve)).toBe(false);
		expect(await isPublicEndpoint('https://169.254.169.254/push', resolve)).toBe(false);
		expect(await isPublicEndpoint('https://2130706433/push', resolve)).toBe(false);
		expect(await isPublicEndpoint('https://push.attacker.example/sub', resolve)).toBe(false);
		expect(resolve).not.toHaveBeenCalled();
		expect(await isPublicEndpoint('https://fcm.googleapis.com/fcm/send/abc', resolve)).toBe(true);
		expect(resolve).toHaveBeenCalledWith('fcm.googleapis.com');
	});

	it('rejects a push service whose DNS answers point at private space', async () => {
		resolve.mockResolvedValue([{ address: '10.0.0.5' }]);
		await expect(
			isPublicEndpoint('https://fcm.googleapis.com/fcm/send/abc', resolve)
		).resolves.toBe(false);

		resolve.mockResolvedValue([{ address: '2001:db8::1' }, { address: '192.168.1.1' }]);
		await expect(
			isPublicEndpoint('https://fcm.googleapis.com/fcm/send/abc', resolve)
		).resolves.toBe(false);
	});

	it('accepts a push service that resolves only to public addresses', async () => {
		resolve.mockResolvedValue([{ address: '93.184.216.34' }, { address: '2606:2800::1' }]);
		await expect(
			isPublicEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc', resolve)
		).resolves.toBe(true);
	});

	it('rejects unresolvable hostnames', async () => {
		resolve.mockRejectedValue(Object.assign(new Error('queryA ESERVFAIL'), { code: 'ESERVFAIL' }));
		await expect(isPublicEndpoint('https://web.push.apple.com/abcdef', resolve)).resolves.toBe(
			false
		);
	});

	it('keeps the literal shape checks', () => {
		expect(isHttpsEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
		expect(isHttpsEndpoint('https://user:pass@fcm.googleapis.com/fcm/send/abc')).toBe(false);
	});
});
