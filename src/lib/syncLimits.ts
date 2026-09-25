/**
 * Lowest mutation limit supported by every relay implementation. The Cloudflare relay
 * saves or deletes this many records, with full histories, in 30 of its 50 subrequests.
 */
export const MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST = 16;
