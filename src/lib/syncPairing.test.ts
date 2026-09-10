import { describe, expect, it } from 'vitest';
import {
	createOneTimePairingCode,
	createPairingUrl,
	createPairingRequestKey,
	createSyncIdentity,
	formatPairingCode,
	normalizePairingCode,
	openSyncKeyFromPeer,
	pairingCodeFromUrl,
	pairingCodeTag,
	sealSyncKeyForPeer
} from './syncPairing';
describe('sync pairing', () => {
	it('formats and normalizes a one-time pairing code', () => {
		expect(formatPairingCode('0123ABCD4567EFGH')).toBe('0123-ABCD-4567-EFGH');
		expect(normalizePairingCode('0123-abcd-4567-efgh')).toBe('0123ABCD4567EFGH');
		expect(normalizePairingCode('OI23-ABCD-4567-EFGH')).toBe('0123ABCD4567EFGH');
	});
	it('uses a stable opaque tag', () => {
		expect(pairingCodeTag('0123ABCD4567EFGH')).toBe(pairingCodeTag('0123-ABCD-4567-EFGH'));
	});
	it('puts pairing secrets in a URL fragment and reads them back', () => {
		const code = '0123ABCD4567EFGH';
		const link = createPairingUrl('https://notes.example/archive?note=private#old', code);

		expect(link).toBe('https://notes.example/archive#pair=0123ABCD4567EFGH');
		expect(pairingCodeFromUrl(link)).toBe(code);
		expect(pairingCodeFromUrl('https://notes.example/#pair=too-short')).toBeNull();
	});
	it('PAKE encrypts the sync key only for a peer with the same one-time code', () => {
		const identity = createSyncIdentity(),
			code = createOneTimePairingCode(),
			old = createPairingRequestKey(code),
			fresh = createPairingRequestKey(code),
			grant = sealSyncKeyForPeer(identity.syncKey, code, old, fresh.share);
		expect(openSyncKeyFromPeer(code, fresh, old.share, grant)).toBe(identity.syncKey);
		const attacker = createPairingRequestKey(createOneTimePairingCode());
		expect(() =>
			openSyncKeyFromPeer(createOneTimePairingCode(), attacker, old.share, grant)
		).toThrow();
	});
});
