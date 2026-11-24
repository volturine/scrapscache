import type { StoredProfile } from '#lib/profiles.js';
import { relay } from '#lib/relayClient.js';
import { identityFromSyncKey } from '#lib/syncPairing.js';

export type McpWorkspaceStatus = { state: 'local' } | { state: 'ready' } | { state: 'unavailable' };

/**
 * Check which workspaces can be included in a new MCP grant. A synced
 * workspace is identified by its sync key; authenticating that key against
 * the relay also prevents stale or deleted cloud accounts from being shown
 * as selectable. Local sync progress is deliberately not a prerequisite:
 * MCP reads the encrypted cloud account, so an empty account and a workspace
 * with local changes waiting to upload are still valid user choices.
 */
export async function mcpWorkspaceStatuses(
	profiles: StoredProfile[]
): Promise<Record<string, McpWorkspaceStatus>> {
	const statuses: Record<string, McpWorkspaceStatus> = {};
	await Promise.all(
		profiles.map(async (profile) => {
			if (!profile.syncKey) {
				statuses[profile.id] = { state: 'local' };
				return;
			}
			try {
				await relay.accessToken(identityFromSyncKey(profile.syncKey));
				statuses[profile.id] = { state: 'ready' };
			} catch {
				statuses[profile.id] = { state: 'unavailable' };
			}
		})
	);
	return statuses;
}
