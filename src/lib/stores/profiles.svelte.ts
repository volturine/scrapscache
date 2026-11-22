// Workspace orchestration. Every workspace owns its own namespaced dataset and
// is either private (no sync key) or synced. Switching, syncing, unlinking and
// removing are all workspace changes: drain pending writes, change this window's
// identity or the keyring, then reload memory from the target namespace. They run
// one at a time under the workspace lock, which only ever covers work on this
// device. Sync takes no part in a switch: every workspace syncs from its own
// database whichever one a window shows. A change that takes a workspace's key or
// data away is also a rewrite of that workspace, which its sync gives way to.
import { syncStore, PROFILE_META_KEY } from './sync.svelte';
import { notesStore } from './notes.svelte';
import { syncScheduler } from './syncScheduler';
import { clearNotesMirror } from '#lib/noteStorage.js';
import { clearBoardsMirror } from './kanban.svelte';
import { clearRecentNotes } from '#lib/recentNotes.js';
import { clearFiredReminderMirror } from './reminders.svelte';
import {
	isLocalWorkspace,
	nextProfileName,
	profileForSyncKey,
	type StoredProfile
} from '#lib/profiles.js';
import { randomOpaqueId } from '#lib/syncPairing.js';
import {
	isProfileReleased,
	LS_PROFILES,
	markSyncOutbox,
	onProfileDeleted,
	releaseProfile,
	resumeProfile
} from '#lib/db/idb.js';
import { unregisterReminderDevice } from '#lib/reminderWake.js';
import { withWorkspaceLock } from '#lib/webLock.js';

type Outcome = { success: boolean; error?: string };

export class ProfileCoordinator {
	/** True while a workspace change is in progress. */
	switching = $state(false);

	private guard(): string | null {
		// An import is not waited for: it lands in the workspace it was started for,
		// whichever one this window has open by then.
		if (this.switching) return 'Another profile change is still running';
		return null;
	}

	private async activate(target: StoredProfile): Promise<void> {
		syncStore.activateProfile(target);
		// Queue the encrypted profile-name record so a fresh key's account learns
		// its local name (baseline dedupe makes repeat switches free). Queued before
		// the load, whose catch-up then sends it in the same sync.
		if (target.syncKey) await syncStore.queueOutbox([PROFILE_META_KEY]);
		await notesStore.reloadForProfile();
	}

	private async change(fallback: string, run: () => Promise<Outcome>): Promise<Outcome> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			return await withWorkspaceLock(async () => {
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
		// A workspace another window is deleting may still be listed until its
		// delete lands, but it is already gone as far as this window can use it.
		if (!profile || isProfileReleased(profile.id))
			throw new Error('That workspace is no longer on this device');
		return profile;
	}

	/** Create an empty private workspace and make it active. */
	async createLocal(): Promise<Outcome> {
		return this.change('Could not create workspace', async () => {
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
	startSync(profileId: string, name?: string, turnstileToken?: string): Promise<Outcome> {
		return this.moveToNewKey(
			'Could not start sync',
			profileId,
			turnstileToken,
			(profile) => (isLocalWorkspace(profile) ? null : 'That workspace is already synced'),
			name
		);
	}

	/** Give a workspace whose key was deleted from the cloud a new key, and upload
	 * its notes to the new account. Other devices have to pair again. */
	replaceRetiredKey(profileId: string, turnstileToken?: string): Promise<Outcome> {
		return this.moveToNewKey(
			'Could not create a new sync key',
			profileId,
			turnstileToken,
			(profile) => (isLocalWorkspace(profile) ? 'That workspace is not synced' : null)
		);
	}

	/**
	 * Register a new account for a workspace, then put the workspace on its key.
	 * The relay is asked before anything is held: registering can take as long as a
	 * poor connection does, and a workspace change in any window must not wait
	 * behind it. Only the last step, which touches this device alone, is one.
	 */
	private async moveToNewKey(
		fallback: string,
		profileId: string,
		turnstileToken: string | undefined,
		refusal: (profile: StoredProfile) => string | null,
		name?: string
	): Promise<Outcome> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		let asked: StoredProfile;
		try {
			asked = this.find(profileId);
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : fallback };
		}
		const refused = refusal(asked);
		if (refused) return { success: false, error: refused };
		const registered = await syncStore.registerAccount(turnstileToken);
		if (!registered.success || !registered.account)
			return { success: false, error: registered.error ?? 'Registration failed' };
		const { account } = registered;
		let synced = false;
		const result = await this.change(fallback, () =>
			// A sync under the workspace's old key gives way to the new one.
			syncScheduler.rewrite(profileId, async () => {
				// The workspace may have changed while the relay was asked: removed, or
				// given a key by another window. The new account is then left unused.
				const profile = this.find(profileId);
				if (profile.syncKey !== asked.syncKey)
					return { success: false, error: 'This workspace changed meanwhile. Try again.' };
				const assigned = await syncStore.assignKey(profile, account, name);
				synced = syncStore.activeId === profileId;
				if (synced) await this.activate(assigned);
				else {
					await markSyncOutbox(profileId, [PROFILE_META_KEY]);
					syncScheduler.changed(profileId);
				}
				return { success: true };
			})
		);
		// First sync can take a long time for a large workspace. Leave the
		// change first so the UI can show the synced workspace immediately.
		if (synced) void notesStore.syncWithCloudManual().catch(() => undefined);
		return result;
	}

	/**
	 * Publish a synced workspace as the newest cloud version, whichever workspace
	 * this window shows.
	 */
	async forceResync(turnstileToken?: string, profileId?: string | null): Promise<Outcome> {
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			return await notesStore.forcePushWorkspace(profileId ?? syncStore.activeId, turnstileToken);
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not replace the cloud copy'
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
		const blocked = this.guard();
		if (blocked) return { success: false, error: blocked };
		this.switching = true;
		try {
			if (deleteCloud) {
				const asked = this.find(profileId);
				if (isLocalWorkspace(asked)) return { success: true };
				// The relay is asked before anything is held, like registering a new key.
				const deleted = await syncStore.deleteRelayAccount(asked);
				if (!deleted.success) return deleted;
			}
			return await withWorkspaceLock(async () => {
				await notesStore.waitForPendingProfileWrites();
				// A sync of the workspace gives way: its key is about to go.
				return syncScheduler.rewrite(profileId, async () => {
					const profile = this.find(profileId);
					if (isLocalWorkspace(profile)) return { success: true };
					await syncStore.unlinkProfile(profile);
					// Its push subscription goes either way. Best effort: an unreachable relay
					// (or one that already deleted the account) must not surface as an
					// unhandled rejection.
					void unregisterReminderDevice(profile).catch(() => undefined);
					if (syncStore.activeId === profileId) await notesStore.reloadForProfile();
					return { success: true };
				});
			});
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Could not stop syncing'
			};
		} finally {
			this.switching = false;
		}
	}

	/**
	 * Remove a workspace and its notes from this device. A synced workspace's
	 * cloud copy stays. Removing the active workspace switches to another one,
	 * and removing the last one leaves a fresh empty workspace behind.
	 */
	async remove(profileId: string): Promise<Outcome> {
		return this.change('Could not delete workspace', async () => {
			const profile = this.find(profileId);
			if (syncStore.activeId === profileId) {
				const next = syncStore.profiles.find(
					(entry) => entry.id !== profileId && !isProfileReleased(entry.id)
				);
				if (next) await this.activate(next);
				else await this.createAndActivateEmpty();
			}
			// A sync of the workspace gives way: its database is about to go.
			const removal = await syncScheduler.rewrite(profileId, () =>
				syncStore.removeProfile(profileId)
			);
			if (removal === 'failed') return { success: false, error: 'Could not delete workspace' };
			// A pending delete lands the moment the other window lets go, so the
			// mirrors go now: left behind, they would bring its notes back without
			// their attachments into the empty database that opening it creates.
			clearNotesMirror(profileId);
			clearBoardsMirror(profileId);
			clearFiredReminderMirror(profileId);
			clearRecentNotes(profileId);
			if (profile.syncKey) void unregisterReminderDevice(profile).catch(() => undefined);
			if (removal === 'pending')
				return {
					success: false,
					error:
						'This workspace is still open somewhere else. It will finish deleting once that window is closed.'
				};
			return { success: true };
		});
	}

	/**
	 * Another window rewrote the keyring. Adopt it, stop serving every workspace
	 * it no longer names, and leave the open one if it is among them.
	 */
	async adoptKeyring(): Promise<void> {
		const known = syncStore.profiles.map((entry) => entry.id);
		const open = syncStore.activeProfile;
		const named = new Set(syncStore.reloadKeyring().map((entry) => entry.id));
		// A workspace can come back — the default one is recreated whenever it
		// still holds notes — so each one the keyring names is served again.
		for (const id of named) resumeProfile(id);
		for (const id of [...known, syncStore.activeId]) if (!named.has(id)) releaseProfile(id);
		await this.leaveReleasedWorkspace();
		if (open) await this.followKeyChange(open);
	}

	/**
	 * The other window turned sync on or off for the open workspace, or gave it
	 * a new key. Until this window activates the workspace again it keeps reading
	 * and writing under the old key, which may be retired, and still reports the
	 * old sync state. The window that made the change activates it the same way.
	 */
	private async followKeyChange(open: StoredProfile): Promise<void> {
		const changed = () => {
			const current = syncStore.activeProfile;
			return current?.id === open.id && current.syncKey !== open.syncKey ? current : null;
		};
		if (!changed()) return;
		await withWorkspaceLock(async () => {
			// Checked again under the lock: a change that held it may have moved
			// this window to another workspace meanwhile.
			const current = changed();
			if (!current) return;
			await notesStore.waitForPendingProfileWrites();
			await this.activate(current);
		});
	}

	/**
	 * Move off the open workspace, without asking, once this device no longer
	 * holds it: its dataset is gone or going, and anything still writing to it
	 * would build back a dataset no workspace owns. The writes it already queued
	 * fail, and the reload that lands the new workspace clears their errors.
	 */
	async leaveReleasedWorkspace(): Promise<void> {
		if (!isProfileReleased(syncStore.activeId)) return;
		await withWorkspaceLock(async () => {
			// Checked again under the lock: while it waited, this window may have
			// moved on by itself, or another signal may already have moved it.
			if (!isProfileReleased(syncStore.activeId)) return;
			const next = syncStore.profiles.find((entry) => !isProfileReleased(entry.id));
			if (next) await this.activate(next);
			else await this.createAndActivateEmpty();
		});
	}

	/**
	 * Point this window at another workspace. Sync takes no part in it: a sync under
	 * way for either workspace runs on from that workspace's database, undisturbed
	 * (see the sync scheduler). The workspace arrived in is asked to sync without
	 * holding up the caller: the switch is done once its notes are loaded. A caller
	 * that needs the synced state joins that sync with
	 * `notesStore.reconcileWithCloud()`; a failed sync shows on the sync indicator.
	 */
	async switchTo(profileId: string): Promise<Outcome> {
		if (profileId === syncStore.activeId) return { success: true };
		let shouldSync = false;
		const result = await this.change('Could not switch workspace', async () => {
			const target = this.find(profileId);
			await this.activate(target);
			shouldSync = !isLocalWorkspace(target);
			return { success: true };
		});
		// Joins the catch-up its load already asked for instead of asking for another.
		if (result.success && shouldSync) void notesStore.reconcileWithCloud();
		return result;
	}

	/**
	 * Take a sync key received through device pairing. A key this device does not
	 * hold yet gets a workspace of its own, and that workspace syncs like any other
	 * before a window opens it: nothing was written in it here, so what the account
	 * holds is all it ends up with, in its database by the time it is shown.
	 */
	async receiveLinkedKey(syncKey: string): Promise<{ outcome: 'linked'; error?: string }> {
		const blocked = this.guard();
		if (blocked) return { outcome: 'linked', error: blocked };
		this.switching = true;
		try {
			const received = await withWorkspaceLock(async () => {
				const held = profileForSyncKey(syncStore.profiles, syncKey);
				if (held) return held;
				const added: StoredProfile = {
					id: randomOpaqueId(),
					name: nextProfileName(syncStore.profiles),
					syncKey,
					createdAt: Date.now()
				};
				await syncStore.addKeyringEntry(added);
				return added;
			});
			// Nothing is held while the relay is waited for, and `switching` keeps this
			// window where it is.
			const synced = await syncScheduler.request(received.id);
			await withWorkspaceLock(async () => {
				await notesStore.waitForPendingProfileWrites();
				await this.activate(this.find(received.id));
			});
			return synced
				? { outcome: 'linked' }
				: { outcome: 'linked', error: 'Could not sync the received profile' };
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

// The keyring lives in localStorage, so its own `storage` event is the signal:
// it fires in every other window exactly when the keyring changes, and cannot
// drift from the write the way a separate broadcast would.
if (typeof window !== 'undefined') {
	window.addEventListener('storage', (event) => {
		// A null key means the origin was cleared, which takes the keyring with it.
		if (event.key !== null && event.key !== LS_PROFILES) return;
		void profileCoordinator.adoptKeyring().catch((err) => {
			console.error('[profiles] could not adopt a keyring change:', err);
		});
	});
	// Another window started deleting a workspace this one had a connection to.
	// The keyring only changes once that delete lands, which may be never if a
	// third window holds on, so this is the moment to leave it.
	onProfileDeleted(() => {
		void profileCoordinator.leaveReleasedWorkspace().catch((err) => {
			console.error('[profiles] could not leave a deleted workspace:', err);
		});
	});
}
