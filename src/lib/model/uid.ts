/** A universally unique id, on every device and every origin.
 *
 * crypto.randomUUID is the only standard call, but it is gated to secure
 * contexts (HTTPS or localhost): plain-HTTP LAN access to a self-hosted relay
 * 500-crashed every app route on it. The fallback is a UUID v4 from
 * crypto.getRandomValues, which insecure contexts do provide. An engine with
 * neither cannot run this app at all (every key derivation needs Web Crypto),
 * so there is deliberately no weaker tier: silent time/Math.random ids would
 * collide across devices and corrupt sync merges. */
export function uid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const bytes = crypto.getRandomValues(new Uint8Array(16));
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
		return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
	}
	throw new Error('Web Crypto is unavailable; this environment cannot run Scraps Cache.');
}
