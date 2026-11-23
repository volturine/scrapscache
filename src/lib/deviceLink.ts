// Linking a device to a workspace another device holds. The two meet at the relay
// under a code only they know, and the key travels sealed for the new device: the
// relay passes it on and cannot open it.

import { PairingRole, PairingState, type PairingPoll } from '#lib/pairingProtocol.js';
import type { SyncAccount } from '#lib/relayClient.js';
import { serverUrl } from '#lib/serverOrigin.svelte.js';
import {
	createOneTimePairingCode,
	createPairingRequestKey,
	openSyncKeyFromPeer,
	pairingCodeTag,
	sealSyncKeyForPeer
} from '#lib/syncPairing.js';

export type StartedDeviceLink = {
	id: string;
	expiresAt: number;
	role: PairingRole;
	syncCode: string;
	pake: { ephemeralSecret: string; share: string };
};

/** Start linking this device to a workspace another device holds, with the code that device shows. */
export function startDeviceLink(
	input: string
): Promise<{ success: boolean; link?: StartedDeviceLink; error?: string }> {
	return startRendezvous(PairingRole.New, input);
}

/** Start handing a workspace's key to a new device, with a code made here for it to enter. */
export function startExistingDeviceLink(): Promise<{
	success: boolean;
	link?: StartedDeviceLink;
	error?: string;
}> {
	return startRendezvous(PairingRole.Existing, createOneTimePairingCode());
}

async function startRendezvous(
	role: PairingRole,
	input: string
): Promise<{ success: boolean; link?: StartedDeviceLink; error?: string }> {
	try {
		const requestKey = createPairingRequestKey(input);
		const res = await fetch(serverUrl('/api/sync/pair/start'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ codeTag: pairingCodeTag(input), role, publicKey: requestKey.share })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || typeof data.id !== 'string' || typeof data.expiresAt !== 'number')
			return {
				success: false,
				error: typeof data.error === 'string' ? data.error : 'Could not start device rendezvous'
			};
		return {
			success: true,
			link: { id: data.id, expiresAt: data.expiresAt, role, syncCode: input, pake: requestKey }
		};
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Could not start device rendezvous'
		};
	}
}

/**
 * Ask how a link is coming along. The device that holds the workspace passes its
 * `account`: once the two have matched, its key is sealed for the new device and
 * sent. The new device gets that key back as `receivedSyncKey`.
 */
export async function pollDeviceLink(
	link: StartedDeviceLink,
	account: SyncAccount | null
): Promise<{
	success: boolean;
	linked?: boolean;
	matched?: boolean;
	expired?: boolean;
	receivedSyncKey?: string;
	error?: string;
}> {
	try {
		const res = await fetch(serverUrl('/api/sync/pair/poll'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId: link.id })
		});
		const data = (await res.json().catch(() => ({}))) as Partial<PairingPoll>;
		if (!res.ok) return { success: false, error: 'Could not check device rendezvous' };
		if (data.state === PairingState.Waiting) return { success: true };
		if (data.state === PairingState.Expired || data.state === PairingState.NotFound)
			return { success: true, expired: true };
		if (data.state === PairingState.Matched && typeof data.peerPublicKey === 'string') {
			if (link.role === PairingRole.New) return { success: true, matched: true };
			if (!account) return { success: false, error: 'Sync is not set up on this device' };
			const grant = sealSyncKeyForPeer(
				account.syncKey,
				link.syncCode,
				link.pake,
				data.peerPublicKey
			);
			const sent = await fetch(serverUrl('/api/sync/pair/approve'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId: link.id, grant })
			});
			return sent.ok
				? { success: true, linked: true }
				: { success: false, error: 'Could not deliver encrypted sync key' };
		}
		if (data.state !== PairingState.Connected || !data.grant || typeof data.grant !== 'object')
			return { success: false, error: 'Invalid device rendezvous response' };
		if (link.role !== PairingRole.New) return { success: true, linked: true };
		const grant = data.grant as { existingPublicKey?: unknown; ciphertext?: unknown };
		if (typeof grant.ciphertext !== 'string')
			return { success: false, error: 'Invalid encrypted sync key' };
		const receivedSyncKey = openSyncKeyFromPeer(
			link.syncCode,
			link.pake,
			data.peerPublicKey ?? '',
			{
				ciphertext: grant.ciphertext
			}
		);
		return { success: true, linked: true, receivedSyncKey };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Could not complete device rendezvous'
		};
	}
}
