// Workspace orchestration. Every workspace owns its own namespaced dataset and
// is either private (no sync key) or synced. Switching, syncing, unlinking and
// removing are all handovers: drain pending writes, change this window's
// identity, then reload memory from the target namespace. They run under the
// sync web lock so no sync flight can interleave with the handover.
import { syncStore, PROFILE_META_KEY } from './sync.svelte';
import { notesStore, SYNC_LOCK } from './notes.svelte';
import { clearNotesMirror } from '$lib/noteStorage';
import {
	isLocalWorkspace,
	nextProfileName,
	profileForSyncKey,
	type StoredProfile
} from '$lib/profiles';
import { identityFromSyncKey, randomOpaqueId } from '$lib/syncPairing';
import { markSyncOutbox } from '$lib/db/idb';
import { unregisterReminderDevice } from '$lib/reminderWake';

type Outcome = { success: boolean; error?: string };

export class ProfileCoordinator {
	/** True while a workspace handover is in progress. */
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
		if (target.syncKey) await syncStore.queueOutbox([PROFILE_META_KEY]);
	}

	private async handover(
		fallback: string,
		run: () => Promise<Outcome>,
		blockOnSync = true
	): Promise<Outcome> {
		const blocked = this.guard(blockOnSync);
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			return await this.exclusive(async () => {
				await notesStore.waitForPendingProfileWrites();
				return run();
			});
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : fallback };
		} finally {
			this.switching = false;
		}
	}

	private find(profileId: string): StoredProfile {
		const profile = syncStore.profiles.find((entry) => entry.id === profileId);
		if (!profile) throw new Error('That workspace is no longer on this device');
		return profile;
	}

	/** Create an empty private workspace and make it active. */
	async createLocal(): Promise<Outcome> {
		return this.handover('Could not create workspace', async () => {
			await this.createAndActivateEmpty();
			return { success: true };
		});
	}

	private async createAndActivateEmpty(): Promise<void> {
		const profile: StoredProfile = {
			id: randomOpaqueId(),
			name: nextProfileName(syncStore.profiles),
			syncKey: '',
			createdAt: Date.now()
		};
		clearNotesMirror(profile.id);
		await syncStore.addKeyringEntry(profile);
		await this.activate(profile);
	}

	/** Start syncing a private workspace. Its row, name, and notes stay the same. */
	async startSync(profileId: string, name?: string, turnstileToken?: string): Promise<Outcome> {
		let synced = false;
		const result = await this.handover('Could not start sync', async () => {
			const result = await syncStore.register(this.find(profileId), name, turnstileToken);
			if (!result.success || !result.profile)
				return { success: false, error: result.error ?? 'Registration failed' };
			synced = syncStore.activeId === profileId;
			if (synced) await this.activate(result.profile);
			else await markSyncOutbox(profileId, [PROFILE_META_KEY]);
			return { success: true };
		});
		// First sync can take a long time for a large workspace. Leave the
		// handover first so the UI can show the synced workspace immediately.
		if (synced) void notesStore.syncWithCloudManual().catch(() => undefined);
		return result;
	}

	/** Publish a synced workspace as the newest cloud version. */
	async forceResync(turnstileToken?: string, profileId?: string | null): Promise<Outcome> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			if (profileId && profileId !== syncStore.activeId) {
				const target = syncStore.profiles.find((profile) => profile.id === profileId);
				if (!target || isLocalWorkspace(target))
					return { success: false, error: 'That workspace is not synced' };
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

	/**
	 * Stop syncing a workspace on this device and keep it as a private
	 * workspace. With `deleteCloud`, its cloud copy is deleted for every device.
	 */
	async unlink(profileId: string, deleteCloud = false): Promise<Outcome> {
		return this.handover('Could not unlink workspace', async () => {
			const profile = this.find(profileId);
			if (isLocalWorkspace(profile)) return { success: true };
			if (deleteCloud) {
				const result = await syncStore.deleteCloudAccount(profile);
				if (!result.success) return result;
			} else {
				await syncStore.unlinkProfile(profile);
				void unregisterReminderDevice(identityFromSyncKey(profile.syncKey));
			}
			if (syncStore.activeId === profileId) await notesStore.reloadForProfile();
			return { success: true };
		});
	}

	/**
	 * Remove a workspace and its notes from this device. A synced workspace's
	 * cloud copy stays. Removing the active workspace switches to another one,
	 * and removing the last one leaves a fresh empty workspace behind.
	 */
	async remove(profileId: string): Promise<Outcome> {
		return this.handover('Could not delete workspace', async () => {
			const profile = this.find(profileId);
			if (syncStore.activeId === profileId) {
				const next = syncStore.profiles.find((entry) => entry.id !== profileId);
				if (next) await this.activate(next);
				else await this.createAndActivateEmpty();
			}
			if (!(await syncStore.removeProfile(profileId)))
				return { success: false, error: 'Could not delete workspace' };
			clearNotesMirror(profileId);
			if (profile.syncKey) void unregisterReminderDevice(identityFromSyncKey(profile.syncKey));
			return { success: true };
		});
	}

	/** Point this window at another workspace. */
	async switchTo(profileId: string): Promise<Outcome> {
		if (profileId === syncStore.activeId) return { success: true };
		let shouldSync = false;
		const result = await this.handover('Could not switch workspace', async () => {
			const target = this.find(profileId);
			await this.activate(target);
			shouldSync = !isLocalWorkspace(target);
			return { success: true };
		});
		if (!result.success || !shouldSync) return result;
		const synced = await notesStore.syncWithCloudManual();
		if (!synced)
			return {
				success: true,
				error:
					syncStore.lastError ??
					notesStore.lastPersistError ??
					'Switched workspace, but sync did not finish'
			};
		return result;
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
