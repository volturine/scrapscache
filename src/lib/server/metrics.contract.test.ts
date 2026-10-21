import { describe, expect, it } from 'vitest';
import type * as NodeMetrics from './metrics';
import type * as CloudflareMetrics from './cloudflare/metrics';

/**
 * `vite.config.ts` swaps `#lib/server/metrics.js` for the Cloudflare module when
 * `DEPLOY_TARGET=cloudflare`, so only one is ever in the build graph and no call
 * site type-checks against the other. The sync store surfaces drifted that way
 * once already; this keeps the recording functions from doing the same, since a
 * caller that silently stops emitting is invisible until someone needs the data.
 *
 * Compared in both directions, because TypeScript happily accepts a function
 * that ignores trailing parameters.
 */
type NodeApi = typeof NodeMetrics;
type CloudflareApi = typeof CloudflareMetrics;

type AnyFn = (...args: never[]) => unknown;
type Identical<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type SameSignature<A, B> = A extends AnyFn
	? B extends AnyFn
		? Identical<Parameters<A>, Parameters<B>> extends true
			? true
			: false
		: false
	: true;

type SharedKeys = keyof NodeApi & keyof CloudflareApi;

type DriftedMembers = {
	[K in SharedKeys]: SameSignature<NodeApi[K], CloudflareApi[K]> extends true ? never : K;
}[SharedKeys];

/** The Cloudflare module may add exports the Node one has no use for; it may not
 * drop one a call site depends on. */
type MissingFromCloudflare = Exclude<keyof NodeApi, keyof CloudflareApi>;

const _drifted: never = undefined as unknown as DriftedMembers;
const _missingFromCloudflare: never = undefined as unknown as MissingFromCloudflare;

describe('metrics implementations', () => {
	it('keeps the recording surface identical across deployments', () => {
		// The compile-time checks above are the real assertions.
		expect([_drifted, _missingFromCloudflare]).toEqual([undefined, undefined]);
	});
});
