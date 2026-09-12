import { describe, expect, it } from 'vitest';
import type * as NodeMetrics from './metrics';
import type * as CloudflareMetrics from './cloudflare/metrics';
import type * as NodeTelemetry from './telemetryQuery';
import type * as CloudflareTelemetry from './cloudflare/telemetryQuery';

/**
 * `vite.config.ts` swaps `$lib/server/metrics` for the Cloudflare module when
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

type TelemetryShared = keyof typeof NodeTelemetry & keyof typeof CloudflareTelemetry;
type DriftedTelemetry = {
	[K in TelemetryShared]: SameSignature<
		(typeof NodeTelemetry)[K],
		(typeof CloudflareTelemetry)[K]
	> extends true
		? never
		: K;
}[TelemetryShared];
type TelemetryMissingFromCloudflare = Exclude<
	keyof typeof NodeTelemetry,
	keyof typeof CloudflareTelemetry
>;

/** The Cloudflare module may add exports the Node one has no use for, such as the
 * dataset name; it may not drop one a call site depends on. */
type MissingFromCloudflare = Exclude<keyof NodeApi, keyof CloudflareApi>;

const _drifted: never = undefined as unknown as DriftedMembers;
const _missingFromCloudflare: never = undefined as unknown as MissingFromCloudflare;
const _driftedTelemetry: never = undefined as unknown as DriftedTelemetry;
const _telemetryMissing: never = undefined as unknown as TelemetryMissingFromCloudflare;

describe('metrics implementations', () => {
	it('keeps the recording surface identical across deployments', () => {
		// The compile-time checks above are the real assertions.
		expect([_drifted, _missingFromCloudflare]).toEqual([undefined, undefined]);
	});

	it('keeps the telemetry read surface identical across deployments', () => {
		expect([_driftedTelemetry, _telemetryMissing]).toEqual([undefined, undefined]);
	});
});
