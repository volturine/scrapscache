/**
 * Lowest mutation limit supported by every relay implementation. The Cloudflare relay
 * saves or deletes this many records, with full histories, in 30 of its 50 subrequests.
 */
export const MAX_CLIENT_SYNC_MUTATIONS_PER_REQUEST = 16;

/**
 * How much ciphertext one downloaded page may hold. Every page row exists twice
 * inside the relay's isolate — once as the decrypted string, once inside the
 * JSON response — and the isolate has ~128 MB, so pages must stop well short
 * of the limit. Notes page to their count limit and photos stop here first.
 */
export const MAX_DOWNLOAD_PAGE_BYTES = 24_000_000;

/**
 * Takes the first `countLimit` rows of an ordered candidate list, but stops
 * early when the page's ciphertext exceeds `byteLimit`. One record that alone
 * would overflow the page still travels alone, so a page must always make
 * progress and the biggest attachment can never wedge the download loop. The
 * caller fetches `countLimit + 1` candidate rows, so `hasMore` is true whenever
 * any row of that list was left out; the download continues from the last
 * delivered seq.
 */
export function fitDownloadPage<T>(
	rows: readonly T[],
	countLimit: number,
	byteLimit: number,
	bytesOf: (row: T) => number
): { page: T[]; hasMore: boolean } {
	const page: T[] = [];
	let used = 0;
	for (const row of rows) {
		if (page.length >= countLimit) break;
		const bytes = Math.max(0, bytesOf(row));
		if (page.length > 0 && used + bytes > byteLimit) break;
		page.push(row);
		used += bytes;
	}
	return { page, hasMore: rows.length > page.length };
}
