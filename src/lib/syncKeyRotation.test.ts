import { describe, expect, it, vi } from 'vitest';
import {
	NOT_SYNCED_MESSAGE,
	ROTATION_STEPS,
	rotateSyncKey,
	type RotationPorts,
	type RotationStep
} from './syncKeyRotation';

type Harness = { ports: RotationPorts; calls: string[] };

function harness(
	overrides: Partial<RotationPorts> = {},
	readiness = { downloadsDrained: true, pendingUploads: 0 }
): Harness {
	const calls: string[] = [];
	const record =
		<T>(name: string, result: T) =>
		async () => {
			calls.push(name);
			return result;
		};
	const ports: RotationPorts = {
		readiness: record('readiness', readiness),
		exportBackup: record('exportBackup', undefined),
		createReplacement: record('createReplacement', undefined),
		uploadAll: record('uploadAll', undefined),
		countLocalRecords: record('countLocalRecords', 5),
		countRemoteRecords: record('countRemoteRecords', 5),
		discardReplacement: record('discardReplacement', undefined),
		discardPrevious: record('discardPrevious', undefined),
		...Object.fromEntries(
			Object.entries(overrides).map(([name, fn]) => [
				name,
				async (...args: never[]) => {
					calls.push(name);
					return (fn as (...a: never[]) => unknown)(...args);
				}
			])
		)
	};
	return { ports, calls };
}

const fails = (message: string) => () => Promise.reject(new Error(message));

describe('replacing a sync key', () => {
	it('builds the new account, proves it, then drops the old one', async () => {
		const { ports, calls } = harness();
		const steps: RotationStep[] = [];

		const outcome = await rotateSyncKey(ports, { onStep: (step) => steps.push(step) });

		expect(outcome).toEqual({ ok: true, forced: false, previousAccountRemoved: true });
		expect(steps).toEqual([...ROTATION_STEPS]);
		expect(calls).toEqual([
			'readiness',
			'exportBackup',
			'createReplacement',
			'uploadAll',
			'countLocalRecords',
			'countRemoteRecords',
			'discardPrevious'
		]);
	});

	it('writes the backup before the first change, not after', async () => {
		const { ports, calls } = harness();
		await rotateSyncKey(ports);
		// If this ever reverses, a failed rotation can leave no copy of the data.
		expect(calls.indexOf('exportBackup')).toBeLessThan(calls.indexOf('createReplacement'));
	});
});

describe('the old account survives every failure before the commit point', () => {
	const failures: Array<[string, Partial<RotationPorts>, RotationStep]> = [
		['the backup cannot be written', { exportBackup: fails('disk full') }, 'backup'],
		[
			'the new account cannot be created',
			{ createReplacement: fails('register failed') },
			'replace'
		],
		['the upload fails', { uploadAll: fails('quota exceeded') }, 'upload'],
		['the new account is short of records', { countRemoteRecords: async () => 4 }, 'confirm']
	];

	for (const [name, overrides, step] of failures) {
		it(`keeps it when ${name}`, async () => {
			const { ports, calls } = harness(overrides);

			const outcome = await rotateSyncKey(ports);

			expect(outcome.ok).toBe(false);
			expect(outcome.ok === false && outcome.step).toBe(step);
			// The one assertion that matters: nothing was thrown away.
			expect(calls).not.toContain('discardPrevious');
		});
	}

	it('says how short the new account was, rather than just failing', async () => {
		const { ports } = harness({ countRemoteRecords: async () => 2 });
		const outcome = await rotateSyncKey(ports);
		expect(outcome.ok === false && outcome.error).toContain('2 of 5');
	});

	it('cleans up the half-built replacement', async () => {
		const { ports, calls } = harness({ uploadAll: fails('network') });
		const outcome = await rotateSyncKey(ports);
		expect(calls).toContain('discardReplacement');
		expect(outcome.ok === false && outcome.replacementRemoved).toBe(true);
	});

	it('reports an orphan it could not clean up instead of implying a clean abort', async () => {
		const { ports } = harness({
			uploadAll: fails('network'),
			discardReplacement: fails('also offline')
		});
		const outcome = await rotateSyncKey(ports);
		expect(outcome.ok === false && outcome.replacementRemoved).toBe(false);
	});
});

describe('a device that has not finished syncing', () => {
	const stale = { downloadsDrained: false, pendingUploads: 3 };

	it('is refused, because it would publish partial state as the new truth', async () => {
		const { ports, calls } = harness({}, stale);

		const outcome = await rotateSyncKey(ports);

		expect(outcome).toEqual({
			ok: false,
			step: 'preflight',
			error: NOT_SYNCED_MESSAGE,
			replacementRemoved: false
		});
		expect(calls).toEqual(['readiness']);
	});

	it('proceeds when the caller has explicitly accepted the loss, and records that', async () => {
		const { ports } = harness({}, stale);

		const outcome = await rotateSyncKey(ports, { force: true });

		expect(outcome).toEqual({ ok: true, forced: true, previousAccountRemoved: true });
	});

	it('counts an undrained download on its own as not synced', async () => {
		const { ports } = harness({}, { downloadsDrained: false, pendingUploads: 0 });
		expect((await rotateSyncKey(ports)).ok).toBe(false);
	});
});

describe('after the commit point', () => {
	it('still counts as rotated when the old account will not delete', async () => {
		const { ports } = harness({ discardPrevious: fails('relay unavailable') });

		const outcome = await rotateSyncKey(ports);

		// The device is on the new key and its data is proven uploaded. Calling
		// this a failure would push the user to retry a rotation already done.
		expect(outcome).toEqual({ ok: true, forced: false, previousAccountRemoved: false });
	});

	it('never tries to undo the replacement once the old account is gone', async () => {
		const { ports, calls } = harness({ discardPrevious: fails('relay unavailable') });
		await rotateSyncKey(ports);
		expect(calls).not.toContain('discardReplacement');
	});
});

describe('progress reporting', () => {
	it('stops at the step that failed', async () => {
		const onStep = vi.fn();
		const { ports } = harness({ createReplacement: fails('nope') });

		await rotateSyncKey(ports, { onStep });

		expect(onStep.mock.calls.map(([step]) => step)).toEqual(['preflight', 'backup', 'replace']);
	});
});
