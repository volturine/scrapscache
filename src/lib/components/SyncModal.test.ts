import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncIdentity, identityFromSyncKey } from '$lib/syncPairing';
import type { StoredProfile } from '$lib/profiles';
import { notesStore } from '$lib/stores/notes.svelte';
import { profileCoordinator } from '$lib/stores/profiles.svelte';
import { syncStore, type StartedDeviceLink } from '$lib/stores/sync.svelte';
import SyncModal from './SyncModal.svelte';

function profile(id: string, name: string, createdAt: number): StoredProfile {
	return { id, name, createdAt, syncKey: createSyncIdentity().syncKey };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

describe('SyncModal profile interactions', () => {
	let main: StoredProfile;
	let side: StoredProfile;

	beforeEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
		main = profile('profile-main', 'Main', 1);
		side = profile('profile-side', 'Side', 2);
		syncStore.profiles = [main, side];
		syncStore.account = identityFromSyncKey(main.syncKey);
		syncStore.lastError = null;
		syncStore.progress = null;
		syncStore.usage = null;
		profileCoordinator.switching = false;
		(notesStore as unknown as { syncFlight: Promise<boolean> | null }).syncFlight = null;
	});

	it('finishes a switch and dismisses the sync screen', async () => {
		const handover = deferred<{ success: boolean }>();
		vi.spyOn(profileCoordinator, 'switchTo').mockImplementation(async () => {
			const result = await handover.promise;
			syncStore.activateProfile(side);
			return result;
		});
		const onClose = vi.fn();
		render(SyncModal, { props: { onClose } });

		const target = screen.getByRole('button', { name: 'Switch to Side' }) as HTMLButtonElement;
		await fireEvent.click(target);
		expect(target.disabled).toBe(true);
		expect((screen.getByLabelText('Close') as HTMLButtonElement).disabled).toBe(true);

		handover.resolve({ success: true });
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
	});

	it('reveals row actions with a swipe without switching and keeps vertical scrolling separate', async () => {
		const switchTo = vi.spyOn(profileCoordinator, 'switchTo');
		render(SyncModal, { props: { onClose: vi.fn() } });
		const row = screen.getByRole('button', { name: 'Switch to Side' });
		// How far the row has been pulled aside is the only signal of the drawer,
		// since a swipe is the sole way to open it.
		const drawerOffset = () =>
			(row.closest('.row') as HTMLElement).style.getPropertyValue('--swipe-offset');
		async function pointer(type: string, x: number, y: number) {
			const event = new Event(type, { bubbles: true });
			Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y });
			await fireEvent(row, event);
		}
		await pointer('pointerdown', 200, 100);
		await pointer('pointermove', 190, 160);
		await pointer('pointerup', 190, 160);
		expect(drawerOffset()).toBe('0px');
		await pointer('pointerdown', 200, 100);
		await pointer('pointermove', 70, 105);
		await pointer('pointerup', 70, 105);
		expect(drawerOffset()).toBe('-152px');
		await fireEvent.click(row);
		expect(switchTo).not.toHaveBeenCalled();
		expect(drawerOffset()).toBe('-152px');
		await fireEvent.click(screen.getByRole('button', { name: 'Rename Side' }));
		expect(screen.getByRole('textbox', { name: 'Workspace name' })).toBeTruthy();
		// The list stays put: renaming happens on the row, not on its own screen.
		expect(screen.getByRole('button', { name: 'Main is active' })).toBeTruthy();
	});

	it('keeps a swipe with the row it started on when the finger drifts onto another row', async () => {
		const switchTo = vi.spyOn(profileCoordinator, 'switchTo');
		render(SyncModal, { props: { onClose: vi.fn() } });
		const row = screen.getByRole('button', { name: 'Switch to Side' });
		const neighbour = screen.getByRole('button', { name: 'Main is active' });
		const drawerOffset = () =>
			(row.closest('.row') as HTMLElement).style.getPropertyValue('--swipe-offset');
		async function pointer(target: Element, type: string, x: number, y: number) {
			const event = new Event(type, { bubbles: true });
			Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y });
			await fireEvent(target, event);
		}

		await pointer(row, 'pointerdown', 200, 100);
		// Drifting down first reads as a scroll, so the row stays put but the
		// gesture is not thrown away.
		await pointer(row, 'pointermove', 196, 140);
		expect(drawerOffset()).toBe('0px');
		// Pulling left now counts, even though the finger sits over another row.
		await pointer(neighbour, 'pointermove', 90, 150);
		expect(drawerOffset()).toBe('-110px');
		await pointer(neighbour, 'pointerup', 90, 150);

		expect(drawerOffset()).toBe('-152px');
		expect(switchTo).not.toHaveBeenCalled();
	});

	it('renames a workspace inline and keeps the row editable when saving fails', async () => {
		const rename = vi
			.spyOn(syncStore, 'renameProfile')
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ ...side, name: 'Studio' });
		render(SyncModal, { props: { onClose: vi.fn() } });

		await fireEvent.click(screen.getByRole('button', { name: 'Rename Side' }));
		const field = screen.getByRole('textbox', { name: 'Workspace name' }) as HTMLInputElement;
		expect(field.value).toBe('Side');

		await fireEvent.input(field, { target: { value: 'Studio' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
		await waitFor(() => expect(screen.getByText('Could not rename that workspace')).toBeTruthy());
		expect(screen.getByRole('textbox', { name: 'Workspace name' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
		await waitFor(() =>
			expect(screen.queryByRole('textbox', { name: 'Workspace name' })).toBeNull()
		);
		expect(rename).toHaveBeenLastCalledWith(side.id, 'Studio');
	});

	it('escapes an inline rename without saving', async () => {
		const rename = vi.spyOn(syncStore, 'renameProfile');
		render(SyncModal, { props: { onClose: vi.fn() } });

		await fireEvent.click(screen.getByRole('button', { name: 'Rename Side' }));
		const field = screen.getByRole('textbox', { name: 'Workspace name' });
		await fireEvent.input(field, { target: { value: 'Discarded' } });
		await fireEvent.keyDown(field, { key: 'Escape' });

		expect(rename).not.toHaveBeenCalled();
		expect(screen.queryByRole('textbox', { name: 'Workspace name' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Switch to Side' })).toBeTruthy();
	});

	it('focuses and selects the name when an inline rename opens', async () => {
		render(SyncModal, { props: { onClose: vi.fn() } });

		await fireEvent.click(screen.getByRole('button', { name: 'Rename Side' }));
		const field = screen.getByRole('textbox', { name: 'Workspace name' }) as HTMLInputElement;

		expect(document.activeElement).toBe(field);
		expect(field.selectionStart).toBe(0);
		expect(field.selectionEnd).toBe('Side'.length);
	});

	it('keeps Escape with the row while it edits, and returns it to the dialog after', async () => {
		const onClose = vi.fn();
		render(SyncModal, { props: { onClose } });

		await fireEvent.click(screen.getByRole('button', { name: 'Rename Side' }));
		const field = screen.getByRole('textbox', { name: 'Workspace name' });

		// The row consumes this one: it cancels the rename without closing the sheet.
		await fireEvent.keyDown(field, { key: 'Escape' });
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.queryByRole('textbox', { name: 'Workspace name' })).toBeNull();

		// With no row busy, Escape belongs to the dialog again.
		await tick();
		expect(screen.getByRole('button', { name: 'Rename Side' })).toBeTruthy();
	});

	it('keeps Escape with a row whose swipe drawer is open', async () => {
		const onClose = vi.fn();
		render(SyncModal, { props: { onClose } });
		const row = screen.getByRole('button', { name: 'Switch to Side' });
		const drawerOffset = () =>
			(row.closest('.row') as HTMLElement).style.getPropertyValue('--swipe-offset');
		async function pointer(type: string, x: number, y: number) {
			const event = new Event(type, { bubbles: true });
			Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y });
			await fireEvent(row, event);
		}

		await pointer('pointerdown', 200, 100);
		await pointer('pointermove', 70, 105);
		await pointer('pointerup', 70, 105);
		expect(drawerOffset()).toBe('-152px');

		// Escape closes the drawer the row owns, not the sheet around it, wherever
		// the key is pressed.
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(drawerOffset()).toBe('0px');
		expect(onClose).not.toHaveBeenCalled();
	});

	it('holds the dialog open while a row awaits confirmation, wherever Escape lands', async () => {
		const onClose = vi.fn();
		render(SyncModal, { props: { onClose } });

		// Opening the panel removes the button that had focus, so focus falls back
		// to the body. Escape must still reach the row that owns it.
		await fireEvent.click(screen.getByRole('button', { name: 'Unlink Side' }));
		expect(document.activeElement?.closest('.row')).toBeNull();

		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(screen.queryByRole('button', { name: 'Keep Side linked' })).toBeNull();
		expect(onClose).not.toHaveBeenCalled();

		// Once the row is idle again the dialog takes Escape back.
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).toHaveBeenCalled();
	});

	it('requires confirmation on the row before unlinking an inactive workspace', async () => {
		const unlink = vi.spyOn(profileCoordinator, 'unlinkSaved').mockResolvedValue({ success: true });
		render(SyncModal, { props: { onClose: vi.fn() } });
		await fireEvent.click(screen.getByRole('button', { name: 'Unlink Side' }));
		expect(unlink).not.toHaveBeenCalled();
		// Other workspaces stay reachable while one row asks for confirmation.
		expect(screen.getByRole('button', { name: 'Main is active' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Keep Side linked' }));
		expect(unlink).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Unlink Side' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Unlink Side and keep notes' }));
		await waitFor(() => expect(unlink).toHaveBeenCalledWith(side.id));
	});

	it('shows and switches to the anonymous workspace without treating it as a sync key', async () => {
		vi.spyOn(profileCoordinator, 'switchTo').mockImplementation(async (id) => {
			expect(id).toBe('device-local');
			syncStore.activateLocalWorkspace();
			return { success: true };
		});
		const onClose = vi.fn();
		render(SyncModal, { props: { onClose } });

		expect(screen.getByText('Anonymous workspace')).toBeTruthy();
		expect(screen.getByText('Only on this device')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Rename Anonymous workspace' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove Anonymous workspace' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Switch to Anonymous workspace' }));
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect(syncStore.profiles).toEqual([main, side]);
		expect(syncStore.activePid).toBe('device-local');
	});

	it('uses a single primary new-workspace action while anonymous is active', () => {
		syncStore.activateLocalWorkspace();
		render(SyncModal, { props: { onClose: vi.fn() } });

		const create = screen.getByRole('button', { name: '+ New workspace' });
		expect(create.classList.contains('scrapscache-button-primary')).toBe(true);
		expect(screen.queryByText('These notes stay on this device.')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
	});

	it('keeps sync screen open and shows error if switch fails', async () => {
		vi.spyOn(profileCoordinator, 'switchTo').mockResolvedValueOnce({
			success: false,
			error: 'Switch blocked'
		});
		const onClose = vi.fn();
		render(SyncModal, { props: { onClose } });

		const target = screen.getByRole('button', { name: 'Switch to Side' }) as HTMLButtonElement;
		await fireEvent.click(target);

		await waitFor(() => expect(screen.getByText('Switch blocked')).toBeTruthy());
		expect(onClose).not.toHaveBeenCalled();
	});

	it('releases the UI after an unexpected sync rejection', async () => {
		vi.spyOn(notesStore, 'syncWithCloudManual').mockRejectedValueOnce(new Error('relay failed'));
		render(SyncModal, { props: { onClose: vi.fn() } });

		const button = screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement;
		await fireEvent.click(button);

		await waitFor(() => expect(screen.getByText('relay failed')).toBeTruthy());
		expect(button.disabled).toBe(false);
		expect(button.textContent).toContain('Sync now');
	});

	it('confirms replacing cloud data before force resync', async () => {
		const force = vi.spyOn(profileCoordinator, 'forceResync').mockResolvedValue({ success: true });
		render(SyncModal, { props: { onClose: vi.fn() } });

		await fireEvent.click(screen.getByText('Manage workspace'));
		await fireEvent.click(screen.getByRole('button', { name: /Force resync/ }));

		expect(force).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Replace cloud notes' }));
		await waitFor(() => expect(force).toHaveBeenCalledTimes(1));
		expect(screen.getByText('This device’s notes are now the latest cloud version.')).toBeTruthy();
	});

	it('offers recovery for authentication failure and places joining under new workspace', async () => {
		syncStore.lastError = 'Could not start sync authentication';
		render(SyncModal, { props: { onClose: vi.fn() } });
		expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Force resync' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Join existing' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: '+ New workspace' }));
		expect(screen.getByRole('button', { name: 'Join existing' })).toBeTruthy();
	});

	it('shows syncing only for a sync started from the modal', async () => {
		const manualSync = deferred<boolean>();
		vi.spyOn(notesStore, 'syncWithCloudManual').mockReturnValueOnce(manualSync.promise);
		render(SyncModal, { props: { onClose: vi.fn() } });

		await fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
		expect(screen.getByRole('button', { name: 'Syncing…' })).toBeTruthy();
		expect(screen.getByText('Syncing…', { selector: 'p' })).toBeTruthy();

		manualSync.resolve(true);
		await waitFor(() => expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy());
	});

	it('reacts when a store-owned sync starts and ends', async () => {
		render(SyncModal, { props: { onClose: vi.fn() } });
		const syncNow = screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement;

		(notesStore as unknown as { syncFlight: Promise<boolean> | null }).syncFlight = new Promise(
			() => undefined
		);
		await tick();
		expect(syncNow.disabled).toBe(true);
		expect(syncNow.textContent).toContain('Sync now');
		expect(screen.queryByText('Syncing…')).toBeNull();

		(notesStore as unknown as { syncFlight: Promise<boolean> | null }).syncFlight = null;
		await tick();
		const target = screen.getByRole('button', { name: 'Switch to Side' }) as HTMLButtonElement;

		(notesStore as unknown as { syncFlight: Promise<boolean> | null }).syncFlight = new Promise(
			() => undefined
		);
		await tick();
		expect(target.disabled).toBe(true);
		expect(screen.getByText('Wait for sync to finish before changing workspaces.')).toBeTruthy();

		(notesStore as unknown as { syncFlight: Promise<boolean> | null }).syncFlight = null;
		await tick();
		expect(target.disabled).toBe(false);
	});

	it('unlinks the active workspace from its own row and reports where the notes went', async () => {
		const unlink = vi.spyOn(profileCoordinator, 'unlink').mockResolvedValue({ success: true });
		render(SyncModal, { props: { onClose: vi.fn() } });

		await fireEvent.click(screen.getByRole('button', { name: 'Unlink Main' }));
		expect(screen.getByText(/notes move to Anonymous workspace/i)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Unlink Main and keep notes' }));

		await waitFor(() => expect(unlink).toHaveBeenCalledWith());
		expect(
			screen.getByText('Notes moved to Anonymous workspace. Cloud data is unchanged.')
		).toBeTruthy();
	});

	it('requires confirmation before deleting cloud data', async () => {
		const unlink = vi.spyOn(profileCoordinator, 'unlink').mockResolvedValue({ success: true });
		render(SyncModal, { props: { onClose: vi.fn() } });
		await fireEvent.click(screen.getByText('Manage workspace'));
		await fireEvent.click(screen.getByRole('button', { name: /Delete cloud data/ }));
		expect(unlink).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete cloud data' }));
		await waitFor(() => expect(unlink).toHaveBeenCalledWith(true));
	});

	it('never overlaps pairing polls', async () => {
		vi.useFakeTimers();
		const link: StartedDeviceLink = {
			id: 'link-1',
			expiresAt: Date.now() + 60_000,
			role: 'existing',
			syncCode: 'ABCD1234EFGH5678',
			pake: { ephemeralSecret: 'secret', share: 'share' }
		};
		const firstPoll = deferred<{
			success: boolean;
			linked: boolean;
			expired: boolean;
		}>();
		vi.spyOn(syncStore, 'startExistingDeviceLink').mockResolvedValue({ success: true, link });
		const poll = vi
			.spyOn(syncStore, 'pollDeviceLink')
			.mockImplementationOnce(() => firstPoll.promise)
			.mockResolvedValue({ success: true, linked: false, expired: false });
		render(SyncModal, { props: { onClose: vi.fn() } });

		await fireEvent.click(screen.getByRole('button', { name: 'Connect device' }));
		expect(poll).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(poll).toHaveBeenCalledTimes(1);

		firstPoll.resolve({ success: true, linked: false, expired: false });
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(1_500);
		expect(poll).toHaveBeenCalledTimes(2);
	});
});
