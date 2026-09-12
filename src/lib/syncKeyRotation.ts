/**
 * Replacing a sync key means building a second account, proving it holds
 * everything, and only then throwing the first one away. The ordering is the
 * whole design, so it lives here on its own, driven through a small set of
 * capabilities that a test can fail at any point.
 */

export const ROTATION_STEPS = [
	'preflight',
	'backup',
	'replace',
	'upload',
	'confirm',
	'discard'
] as const;

export type RotationStep = (typeof ROTATION_STEPS)[number];

export type RotationReadiness = {
	downloadsDrained: boolean;
	pendingUploads: number;
};

export type RotationPorts = {
	/** Whether this device is holding the whole account, or only part of it. */
	readiness(): Promise<RotationReadiness>;
	/** Write an encrypted backup before anything is changed. */
	exportBackup(): Promise<void>;
	/** Register a new key and copy this workspace's dataset into it. */
	createReplacement(): Promise<void>;
	/** Push the copied dataset to the new account. */
	uploadAll(): Promise<void>;
	countLocalRecords(): Promise<number>;
	countRemoteRecords(): Promise<number>;
	/** Undo a partial replacement. Only ever called before the commit point. */
	discardReplacement(): Promise<void>;
	/** Delete the account the replaced key opened. The commit point. */
	discardPrevious(): Promise<void>;
};

export type RotationOutcome =
	| { ok: true; forced: boolean; previousAccountRemoved: boolean }
	| { ok: false; step: RotationStep; error: string; replacementRemoved: boolean };

export type RotationOptions = {
	/** Rotate from a device that has not finished syncing. Anything the relay
	 * holds and this device does not is lost, so the caller must have said so. */
	force?: boolean;
	onStep?: (step: RotationStep) => void;
};

export const NOT_SYNCED_MESSAGE =
	'This device has not finished syncing, so it may not hold everything in the account. ' +
	'Finish syncing first, or confirm that you want to continue without it.';

function message(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export function isStale(readiness: RotationReadiness): boolean {
	return !readiness.downloadsDrained || readiness.pendingUploads > 0;
}

export async function rotateSyncKey(
	ports: RotationPorts,
	options: RotationOptions = {}
): Promise<RotationOutcome> {
	let step: RotationStep = 'preflight';
	const enter = (next: RotationStep) => {
		step = next;
		options.onStep?.(next);
	};

	// Nothing below this point has changed anything yet, so a failure here simply
	// leaves the device as it was.
	let forced = false;
	try {
		enter('preflight');
		const readiness = await ports.readiness();
		forced = isStale(readiness);
		if (forced && !options.force) {
			return { ok: false, step: 'preflight', error: NOT_SYNCED_MESSAGE, replacementRemoved: false };
		}
		enter('backup');
		await ports.exportBackup();
	} catch (error) {
		return {
			ok: false,
			step,
			error: message(error, 'Could not prepare to replace the sync key'),
			replacementRemoved: false
		};
	}

	// A replacement account may exist from here on. The previous one is still
	// untouched, so any failure unwinds towards it.
	try {
		enter('replace');
		await ports.createReplacement();
		enter('upload');
		await ports.uploadAll();
		enter('confirm');
		const [local, remote] = await Promise.all([
			ports.countLocalRecords(),
			ports.countRemoteRecords()
		]);
		if (remote < local) {
			throw new Error(
				`The new account holds ${remote} of ${local} records, so nothing was removed`
			);
		}
	} catch (error) {
		let replacementRemoved = false;
		try {
			await ports.discardReplacement();
			replacementRemoved = true;
		} catch {
			// Leaves an unused account behind, which costs storage and nothing else.
			// Reported so the caller can say so rather than implying a clean abort.
		}
		return {
			ok: false,
			step,
			error: message(error, 'Could not move this account to a new sync key'),
			replacementRemoved
		};
	}

	// The new account is proven complete, so the old one is now redundant.
	// Failing to delete it leaves an orphan, not a loss: the rotation itself
	// succeeded and the device is already on the new key.
	enter('discard');
	try {
		await ports.discardPrevious();
		return { ok: true, forced, previousAccountRemoved: true };
	} catch {
		return { ok: true, forced, previousAccountRemoved: false };
	}
}
