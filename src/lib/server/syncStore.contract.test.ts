import { describe, expect, it } from 'vitest';
import type { SyncStore as NodeSyncStore } from './syncStore';
import type { SyncStore as CloudflareSyncStore } from './cloudflare/syncStore';

/**
 * `vite.config.ts` swaps `$lib/server/syncStore` for the Cloudflare module when
 * `DEPLOY_TARGET=cloudflare`, so exactly one implementation is live per
 * deployment and no call site ever type-checks against the Cloudflare one. That
 * let the two drift apart silently: `sync` and `createEventStream` both gained
 * a client id on the Node side that Cloudflare never grew, which disabled SSE
 * self-echo suppression in production without any build failing.
 *
 * Plain assignability is not enough to catch that. TypeScript accepts a
 * function that ignores trailing parameters, so a Cloudflare method missing an
 * optional argument still satisfies the Node type. The checks below compare
 * parameter tuples in both directions instead, which is what makes a dropped
 * argument a compile error.
 *
 * This lives in a test so it stays out of the swapped build graph while still
 * being type-checked by every `npm run check`.
 */

/** Drops private members, which are nominal and never match across classes. */
type PublicApi<T> = { [K in keyof T]: T[K] };

type NodeApi = PublicApi<NodeSyncStore>;
type CloudflareApi = PublicApi<CloudflareSyncStore>;

type AnyMethod = (...args: never[]) => unknown;
type Identical<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type SameSignature<A, B> = A extends AnyMethod
	? B extends AnyMethod
		? Identical<Parameters<A>, Parameters<B>> extends true
			? Identical<ReturnType<A>, ReturnType<B>>
			: false
		: false
	: Identical<A, B>;

type SharedKeys = keyof NodeApi & keyof CloudflareApi;

/** The names of any members whose signatures no longer line up. */
type DriftedMembers = {
	[K in SharedKeys]: SameSignature<NodeApi[K], CloudflareApi[K]> extends true ? never : K;
}[SharedKeys];

type MissingFromCloudflare = Exclude<keyof NodeApi, keyof CloudflareApi>;
type MissingFromNode = Exclude<keyof CloudflareApi, keyof NodeApi>;

// Each of these fails to compile if the surfaces diverge, and the error names
// the offending members. Assigning *to* never is what makes it fail: a union of
// member names is not assignable to never, while never is assignable to
// anything, so the check only works in this direction.
const _drifted: never = undefined as unknown as DriftedMembers;
const _missingFromCloudflare: never = undefined as unknown as MissingFromCloudflare;
const _missingFromNode: never = undefined as unknown as MissingFromNode;

describe('sync store implementations', () => {
	it('keeps the Node and Cloudflare surfaces identical', () => {
		// The compile-time checks above are the real assertions.
		expect([_drifted, _missingFromCloudflare, _missingFromNode]).toEqual([
			undefined,
			undefined,
			undefined
		]);
	});
});
