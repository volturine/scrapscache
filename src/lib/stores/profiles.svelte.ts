// Profile switching orchestration. Datasets are namespaced per profile, so a
// switch is: drain pending writes, flip this window's identity, reload memory
// from the target namespace, then pull that key's cloud deltas. Runs under the
// sync web lock so no sync flight can interleave with the handover.
import { syncStore, PROFILE_META_KEY } from './sync.svelte';
import { notesStore, SYNC_LOCK } from './notes.svelte';
import { clearNotesMirror } from '$lib/noteStorage';
import {
	copyProfileDatasetInto,
	isLocalWorkspace,
	nextProfileName,
	profileForSyncKey,
	readAnonymousWorkspaceName,
	type StoredProfile
} from '$lib/profiles';
import { randomOpaqueId } from '$lib/syncPairing';
import { clearProfileNamespace, LOCAL_PROFILE_ID } from '$lib/db/idb';
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
	async create(
		name?: string,
		turnstileToken?: string,
		sourcePid?: string | null
	): Promise<{ success: boolean; error?: string }> {
		const source =
			sourcePid !== undefined ? sourcePid : syncStore.account ? null : syncStore.activePid;
		return this.createWithDataset(name, source, turnstileToken);
	}

	/** Create an empty local-only workspace. It never registers with the relay. */
	async createLocal(): Promise<{ success: boolean; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			await this.exclusive(async () => {
				await notesStore.waitForPendingProfileWrites();
				const profile = {
					id: randomOpaqueId(),
					name: nextProfileName([{ name: readAnonymousWorkspaceName() }, ...syncStore.profiles]),
					syncKey: '',
					createdAt: Date.now()
				};
				clearNotesMirror(profile.id);
				await syncStore.addKeyringEntry(profile);
				syncStore.activateLocalWorkspace(profile.id);
				await notesStore.reloadForProfile();
			});
			return { success: true };
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not create workspace'
			};
		} finally {
			this.switching = false;
		}
	}

	/** Wipe a local workspace's notes. Extra local workspaces are removed. */
	async wipeLocal(pid: string): Promise<{ success: boolean; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			await this.exclusive(async () => {
				await notesStore.waitForPendingProfileWrites();
				await clearProfileNamespace(pid);
				if (pid !== LOCAL_PROFILE_ID) {
					if (syncStore.activePid === pid) {
						syncStore.activateLocalWorkspace(LOCAL_PROFILE_ID);
						await notesStore.reloadForProfile();
					}
					await syncStore.removeProfile(pid);
				} else if (syncStore.activePid === pid) {
					await notesStore.reloadForProfile();
				}
			});
			return { success: true };
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not delete workspace data'
			};
		} finally {
			this.switching = false;
		}
	}

	private async createWithDataset(
		name: string | undefined,
		sourcePid: string | null,
		turnstileToken: string | undefined
	): Promise<{ success: boolean; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			const created = await this.exclusive(async () => {
				await notesStore.waitForPendingProfileWrites();
				const sourceProfile =
					sourcePid && sourcePid !== LOCAL_PROFILE_ID
						? syncStore.profiles.find((profile) => profile.id === sourcePid)
						: null;
				const reuse = sourceProfile && isLocalWorkspace(sourceProfile) ? sourceProfile : null;
				const result = await syncStore.register(name, turnstileToken, reuse);
				if (!result.success || !result.profile)
					return { success: false, error: result.error ?? 'Registration failed' };
				try {
					if (sourcePid && result.profile.id !== sourcePid) {
						await copyProfileDatasetInto(sourcePid, result.profile.id);
						if (sourcePid === LOCAL_PROFILE_ID) {
							await clearProfileNamespace(LOCAL_PROFILE_ID);
							clearNotesMirror(LOCAL_PROFILE_ID);
						}
					} else if (!sourcePid) {
						clearNotesMirror(result.profile.id);
					}
					await this.activate(result.profile);
					return { success: true };
				} catch (setupErr) {
					if (result.profile.id !== reuse?.id)
						await syncStore.removeProfile(result.profile.id).catch(() => undefined);
					throw setupErr;
				}
			});
			if (!created.success) return created;
			// First sync can take a long time for a large workspace. Leave the
			// handover first so the UI can show the synced workspace immediately.
			void notesStore.syncWithCloudManual().catch(() => undefined);
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

	/** Publish a synced workspace as the newest cloud version. */
	async forceResync(
		turnstileToken?: string,
		profileId?: string | null
	): Promise<{ success: boolean; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			if (profileId && profileId !== syncStore.activePid) {
				const target = syncStore.profiles.find((profile) => profile.id === profileId);
				if (!target || isLocalWorkspace(target))
					return { success: false, error: 'That workspace is no longer on this device' };
				await this.exclusive(async () => {
					await notesStore.waitForPendingProfileWrites();
					await this.activate(target);
				});
			}
			if (!syncStore.account) return { success: false, error: 'No synced workspace is active' };
			const synced = await notesStore.forcePushWorkspace(turnstileToken);
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

	/** Drop this device’s copy of a synced workspace. Cloud notes stay unless `deleteCloud`. */
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

	/** Drop a saved workspace from this device. Cloud notes stay unless `deleteCloud`. */
	async unlinkSaved(
		profileId: string,
		deleteCloud = false
	): Promise<{ success: boolean; error?: string }> {
		if (profileId === syncStore.activeProfile?.id) return this.unlink(deleteCloud);
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		const profile = syncStore.profiles.find((entry) => entry.id === profileId);
		if (!profile) return { success: false, error: 'That workspace is no longer on this device' };
		this.switching = true;
		try {
			return await this.exclusive(async () => {
				await notesStore.waitForPendingProfileWrites();
				if (deleteCloud) {
					const result = await syncStore.deleteCloudAccount(profile);
					if (!result.success) return result;
					if (syncStore.activePid === LOCAL_PROFILE_ID) await notesStore.reloadForProfile();
					return { success: true };
				}
				if (!(await syncStore.removeProfile(profileId)))
					return { success: false, error: 'Could not unlink workspace' };
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
					syncStore.activateLocalWorkspace(LOCAL_PROFILE_ID);
					await notesStore.reloadForProfile();
					return false;
				}
				const target = syncStore.profiles.find((profile) => profile.id === profileId);
				if (!target) throw new Error('That sync key is no longer on this device');
				if (target.id === syncStore.activePid) return false;
				await notesStore.waitForPendingProfileWrites();
				if (isLocalWorkspace(target)) {
					syncStore.activateLocalWorkspace(target.id);
					await notesStore.reloadForProfile();
					return false;
				}
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
				return { isNew: !existed };
			});
			// Both sync paths acquire SYNC_LOCK themselves. Release the handover
			// lock first, while switching continues to block other profile changes.
			const synced = activated.isNew
				? await notesStore.replaceWithCloudManual()
				: await notesStore.syncWithCloudManual();
			if (!synced)
				return {
					outcome: 'linked',
					error: syncStore.lastError ?? 'Could not sync the received profile'
				};
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
