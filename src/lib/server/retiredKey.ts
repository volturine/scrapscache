import { json } from '@sveltejs/kit';

/** The key's owner deleted its cloud data. Distinct from a missing account, which
 * recovery may recreate: a device holding this key has to replace it. */
export function retiredKeyResponse(): Response {
	return json(
		{ error: 'This sync key was deleted from the cloud', retired: true },
		{ status: 410 }
	);
}
