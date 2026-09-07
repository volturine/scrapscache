// Profile switching orchestration. Datasets are namespaced per profile, so a
// switch is: drain pending writes, flip this window's identity, reload memory
// from the target namespace, then pull that key's cloud deltas. Runs under the
// sync web lock so no sync flight can interleave with the handover.
import { syncStore, PROFILE_META_KEY } from './sync.svelte';
import { notesStore, SYNC_LOCK } from './notes.svelte';
import {
	adoptLocalDatasetInto,
	nextProfileName,
	profileForSyncKey,
	type StoredProfile
} from '$lib/profiles';
import { randomOpaqueId } from '$lib/syncPairing';

export class ProfileCoordinator {
	/** True while a create/switch/adopt handover is in progress. */
	switching = $state(false);

	private async exclusive<T>(run: () => Promise<T>): Promise<T> {
		const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
		if (!locks?.request) return run();
		return locks.request(SYNC_LOCK, run);
	}

	private guard(blockOnSync = true): string | null {
		if (this.switching) return 'Another profile change is still running';
		// A running sync must finish before its dataset can be handed over; the
		// web lock below is only a safety net against races, not a waiting room.
		if (blockOnSync && notesStore.syncing)
			return 'Sync is still running. Try again when it finishes.';
		return null;
	}

	private async activate(target: StoredProfile): Promise<void> {
		syncStore.activateProfile(target);
		await notesStore.reloadForProfile();
		// Queue the encrypted profile-name record so a fresh key's account learns
		// its local name (baseline dedupe makes repeat switches free).
		await syncStore.queueOutbox([PROFILE_META_KEY]);
	}

	/** Create a brand-new sync key and make it this window's active profile. */
	async create(name?: string): Promise<{ success: boolean; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			const isFirstAccount = syncStore.profiles.length === 0;
			const created = await this.exclusive(async () => {
				await syncStore.waitForOutboxWrites();
				const result = await syncStore.register(name);
				if (!result.success || !result.profile)
					return { success: false, error: result.error ?? 'Registration failed' };
				// First account on device adopts local device notes so they are pushed to cloud;
				// subsequent accounts start as a clean blank slate.
				if (isFirstAccount) {
					await adoptLocalDatasetInto(result.profile.id);
				}
				await this.activate(result.profile);
				return { success: true };
			});
			if (!created.success) return created;
			// Manual sync acquires the same non-reentrant web lock, so it must
			// start after the namespace handover releases that lock.
			const synced = await notesStore.syncWithCloudManual();
			return synced
				? { success: true }
				: {
						success: true,
						error:
							syncStore.lastError ??
							notesStore.lastPersistError ??
							'Created, but the first sync did not finish'
					};
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not switch profiles'
			};
		} finally {
			this.switching = false;
		}
	}

	/** Point this window at another saved sync key's namespace. */
	async switchTo(profileId: string): Promise<{ success: boolean; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			const changed = await this.exclusive(async () => {
				const target = syncStore.profiles.find((profile) => profile.id === profileId);
				if (!target) throw new Error('That sync key is no longer on this device');
				if (target.id === syncStore.activeProfile?.id) return false;
				await syncStore.waitForOutboxWrites();
				await this.activate(target);
				return true;
			});
			if (changed) {
				const synced = await notesStore.syncWithCloudManual();
				if (!synced)
					return {
						success: true,
						error:
							syncStore.lastError ??
							notesStore.lastPersistError ??
							'Switched profiles, but sync did not finish'
					};
			}
			return { success: true };
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not switch profiles'
			};
		} finally {
			this.switching = false;
		}
	}

	/**
	 * Activate a sync key received via device pairing.
	 * Starting from a blank slate locally, it pulls all records from the cloud.
	 */
	async receiveLinkedKey(syncKey: string): Promise<{ outcome: 'linked'; error?: string }> {
		const blocked = this.guard(false);
		if (blocked) return { outcome: 'linked', error: blocked };
		this.switching = true;
		try {
			const activated = await this.exclusive(async () => {
				await syncStore.waitForOutboxWrites();
				let profile = profileForSyncKey(syncStore.profiles, syncKey);
				const existed = profile != null;
				if (!profile) {
					profile = {
						id: randomOpaqueId(),
						name: nextProfileName(syncStore.profiles),
						syncKey,
						createdAt: Date.now()
					};
					await syncStore.addKeyringEntry(profile);
				}
				await this.activate(profile);
				if (existed) {
					return { success: true, isNew: false };
				}
				// Linking an existing sync key starts local as a blank slate and pulls everything from cloud!
				const synced = await notesStore.replaceWithCloudManual();
				if (!synced)
					return {
						success: false,
						error: syncStore.lastError ?? 'Could not sync the received profile'
					};
				return { success: true, isNew: true };
			});
			if (!activated.success) return { outcome: 'linked', error: activated.error };
			if (!activated.isNew) {
				const synced = await notesStore.syncWithCloudManual();
				if (!synced)
					return {
						outcome: 'linked',
						error: syncStore.lastError ?? 'Could not sync the received profile'
					};
			}
			return { outcome: 'linked' };
		} catch (err) {
			return {
				outcome: 'linked',
				error: err instanceof Error ? err.message : 'Could not set up the received sync key'
			};
		} finally {
			this.switching = false;
		}
	}
}

export const profileCoordinator = new ProfileCoordinator();
