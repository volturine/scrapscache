import { isValidSyncKey } from './crypto.js';

export const MIN_SECRET_LENGTH = 32;

export type RuntimeSecretConfig = {
	MCP_SECRET?: string;
	MCP_BEARER_TOKEN?: string;
	SCRAPSCACHE_SYNC_KEY?: string;
	MCP_FRIENDS_TOKENS?: string;
};

function clean(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

export function validateRuntimeSecrets(config: RuntimeSecretConfig): string | null {
	const secret = clean(config.MCP_SECRET);
	if (!secret) return 'MCP_SECRET must be configured';
	if (secret.length < MIN_SECRET_LENGTH) {
		return `MCP_SECRET must contain at least ${MIN_SECRET_LENGTH} characters`;
	}

	const bearer = clean(config.MCP_BEARER_TOKEN);
	if (bearer && bearer.length < MIN_SECRET_LENGTH) {
		return `MCP_BEARER_TOKEN must contain at least ${MIN_SECRET_LENGTH} characters`;
	}

	const syncKey = clean(config.SCRAPSCACHE_SYNC_KEY);
	if (syncKey && !isValidSyncKey(syncKey)) {
		return 'SCRAPSCACHE_SYNC_KEY must be a 32-byte Base64URL sync key';
	}

	const friends = clean(config.MCP_FRIENDS_TOKENS);
	if (friends) {
		try {
			const parsed = JSON.parse(friends) as unknown;
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return 'MCP_FRIENDS_TOKENS must be a JSON object';
			}
			for (const [token, value] of Object.entries(parsed)) {
				if (
					token.length < MIN_SECRET_LENGTH ||
					typeof value !== 'string' ||
					!isValidSyncKey(value)
				) {
					return 'MCP_FRIENDS_TOKENS contains an invalid token or sync key';
				}
			}
		} catch {
			return 'MCP_FRIENDS_TOKENS must be valid JSON';
		}
	}

	return null;
}

export function requireRuntimeSecrets(config: RuntimeSecretConfig): string {
	const error = validateRuntimeSecrets(config);
	if (error) throw new Error(error);
	return config.MCP_SECRET!.trim();
}
