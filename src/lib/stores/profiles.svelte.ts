// Profile switching orchestration. Datasets are namespaced per profile, so a
// switch is: drain pending writes, flip this window's identity, reload memory
// from the target namespace, then pull that key's cloud deltas. Runs under the
// sync web lock so no sync flight can interleave with the handover.
import { syncStore, PROFILE_META_KEY } from './sync.svelte';
import { notesStore, SYNC_LOCK } from './notes.svelte';
import { clearNotesMirror } from '$lib/noteStorage';
import {
	copyProfileDatasetInto,
	nextProfileName,
	profileForSyncKey,
	type StoredProfile
} from '$lib/profiles';
import { randomOpaqueId } from '$lib/syncPairing';
import { LOCAL_PROFILE_ID, unlinkProfileToNamespace } from '$lib/db/idb';
import { unregisterReminderDevice } from '$lib/reminderWake';

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
		const sourcePid = syncStore.activePid === LOCAL_PROFILE_ID ? LOCAL_PROFILE_ID : null;
		return this.createWithDataset(name, sourcePid);
	}

	private async createWithDataset(
		name: string | undefined,
		sourcePid: string | null
	): Promise<{ success: boolean; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			const created = await this.exclusive(async () => {
				await notesStore.waitForPendingProfileWrites();
				const result = await syncStore.register(name);
				if (!result.success || !result.profile)
					return { success: false, error: result.error ?? 'Registration failed' };
				try {
					// Normal creation from a synced profile starts blank. Recovery creation
					// and creation from the anonymous workspace copy their selected source.
					if (sourcePid) {
						await copyProfileDatasetInto(sourcePid, result.profile.id);
					} else {
						clearNotesMirror(result.profile.id);
					}
					await this.activate(result.profile);
					return { success: true };
				} catch (setupErr) {
					await syncStore.removeProfile(result.profile.id).catch(() => undefined);
					throw setupErr;
				}
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

	/** Publish this device's workspace as the newest cloud version. */
	async forceResync(): Promise<{ success: boolean; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		if (!syncStore.account) return { success: false, error: 'No synced workspace is active' };
		this.switching = true;
		try {
			const synced = await notesStore.forcePushWorkspace();
			return synced
				? { success: true }
				: {
						success: false,
						error:
							syncStore.lastError ?? notesStore.lastPersistError ?? 'Force resync did not finish'
					};
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not force resync'
			};
		} finally {
			this.switching = false;
		}
	}

	/** Append this workspace to anonymous storage before leaving its sync key. */
	async unlink(deleteCloud = false): Promise<{ success: boolean; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			return await this.exclusive(async () => {
				await notesStore.waitForPendingProfileWrites();
				const account = syncStore.account;
				if (!account) return { success: false, error: 'No synced workspace is active' };
				if (deleteCloud) {
					const result = await syncStore.deleteCloudAccount();
					if (!result.success) return result;
				} else {
					await syncStore.logout();
					void unregisterReminderDevice(account);
				}
				await notesStore.reloadForProfile();
				return { success: true };
			});
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not unlink workspace'
			};
		} finally {
			this.switching = false;
		}
	}

	/** Unlink a saved, inactive workspace and preserve its local data anonymously. */
	async unlinkSaved(profileId: string): Promise<{ success: boolean; error?: string }> {
		if (profileId === syncStore.activeProfile?.id) return this.unlink();
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		if (!syncStore.profiles.some((profile) => profile.id === profileId))
			return { success: false, error: 'That workspace is no longer on this device' };
		this.switching = true;
		try {
			return await this.exclusive(async () => {
				await notesStore.waitForPendingProfileWrites();
				await unlinkProfileToNamespace(profileId, LOCAL_PROFILE_ID);
				if (!(await syncStore.removeProfile(profileId)))
					return { success: false, error: 'Could not unlink workspace' };
				if (syncStore.activePid === LOCAL_PROFILE_ID) await notesStore.reloadForProfile();
				return { success: true };
			});
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not unlink workspace'
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
			const shouldSync = await this.exclusive(async () => {
				if (profileId === LOCAL_PROFILE_ID) {
					if (syncStore.activePid === LOCAL_PROFILE_ID) return false;
					await notesStore.waitForPendingProfileWrites();
					syncStore.activateLocalWorkspace();
					await notesStore.reloadForProfile();
					return false;
				}
				const target = syncStore.profiles.find((profile) => profile.id === profileId);
				if (!target) throw new Error('That sync key is no longer on this device');
				if (target.id === syncStore.activeProfile?.id) return false;
				await notesStore.waitForPendingProfileWrites();
				await this.activate(target);
				return true;
			});
			if (shouldSync) {
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
				await notesStore.waitForPendingProfileWrites();
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
