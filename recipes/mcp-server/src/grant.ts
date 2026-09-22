import { identityFromSyncKey, isValidSyncKey } from './crypto.js';

export type GrantedWorkspace = {
	name: string;
	syncKey: string;
	accountId: string;
};

export function grantedWorkspaces(
	syncKey: string,
	accountId: string,
	workspaces?: GrantedWorkspace[]
): GrantedWorkspace[] {
	if (workspaces?.length) return workspaces;
	if (!syncKey) return [];
	return [{ name: 'Workspace', syncKey, accountId }];
}

/** Plaintext from the encrypted handshake: a raw sync key, or JSON naming several workspaces. */
export function parseHandshakeGrant(plaintext: string): GrantedWorkspace[] {
	const trimmed = plaintext.trim();
	if (trimmed.length === 0 || trimmed.length > 64 * 1024) {
		throw new Error('Invalid workspace grant');
	}
	if (!trimmed.startsWith('{')) {
		if (!isValidSyncKey(trimmed)) throw new Error('Invalid sync key');
		return [
			{ name: 'Workspace', syncKey: trimmed, accountId: identityFromSyncKey(trimmed).accountId }
		];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		throw new Error('Invalid workspace grant');
	}
	const entries = (parsed as { workspaces?: unknown }).workspaces;
	if (!Array.isArray(entries) || entries.length === 0) {
		throw new Error('No workspaces in grant');
	}
	if (entries.length > 16) throw new Error('Too many workspaces in grant');

	const granted: GrantedWorkspace[] = [];
	const seenKeys = new Set<string>();
	const seenNames = new Set<string>();
	for (const entry of entries) {
		if (!entry || typeof entry !== 'object') continue;
		const syncKey = String((entry as { syncKey?: unknown }).syncKey || '').trim();
		if (!syncKey || !isValidSyncKey(syncKey) || seenKeys.has(syncKey)) continue;
		let name = String((entry as { name?: unknown }).name || '').trim() || 'Workspace';
		if (name.length > 120) name = name.slice(0, 120);
		if (seenNames.has(name)) {
			let suffix = 2;
			while (seenNames.has(`${name} ${suffix}`)) suffix += 1;
			name = `${name} ${suffix}`;
		}
		seenKeys.add(syncKey);
		seenNames.add(name);
		granted.push({ name, syncKey, accountId: identityFromSyncKey(syncKey).accountId });
	}
	if (!granted.length) throw new Error('No workspaces in grant');
	return granted;
}
