import { sha256 as sha256Bytes } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { stableStringify } from './model/stableStringify';

// Deterministic SHA-256 for sync equality checks over stably ordered JSON.
export async function sha256(value: unknown): Promise<string> {
	return bytesToHex(sha256Bytes(new TextEncoder().encode(stableStringify(value))));
}
