import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wakeMocks = vi.hoisted(() => ({
	publish: vi.fn(),
	register: vi.fn(),
	fetch: vi.fn()
}));

vi.mock('#lib/reminderWake.js', () => ({
	publishReminderWakes: wakeMocks.publish,
	registerAllReminderDevices: wakeMocks.register,
	fetchReminderWakes: wakeMocks.fetch
}));

import { ReminderStore, UPCOMING_LIMIT, type ReminderHost } from './reminders.svelte';
import { ReminderHistoryStore } from './reminderHistory';
import { reminderWakeId } from '#lib/model/index.js';
import type { ReminderNote } from '#lib/reminderNotify.js';
import { TEST_WORKSPACE } from '../../tests/workspace';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function note(partial: Partial<ReminderNote> = {}): ReminderNote {
	return {
		id: 'n1',
		title: 'Groceries',
		body: '',
		reminder: Date.now() + HOUR,
		archived: false,
		trashed: false,
		...partial
	};
}

function host(): ReminderHost & { opened: [string, string][]; openedWorkspaces: string[] } {
	const opened: [string, string][] = [];
	const openedWorkspaces: string[] = [];
	return {
		opened,
		openedWorkspaces,
		workspaces: () => [{ id: TEST_WORKSPACE, name: 'Personal', syncKey: null }],
		loadNotes: async () => [],
		reconcile: vi.fn(),
		triggerSync: vi.fn(),
		openNote: (pid, noteId) => opened.push([pid, noteId]),
		openWorkspace: (pid) => openedWorkspaces.push(pid)
	};
}

beforeEach(() => {
	localStorage.clear();
	wakeMocks.publish.mockReset().mockResolvedValue([]);
	wakeMocks.register.mockReset().mockResolvedValue(false);
});

afterEach(() => {
	localStorage.clear();
});

describe('ReminderStore.upcoming', () => {
	it('lists what is still to come, soonest first, with a repeat at each of its times', async () => {
		const store = new ReminderStore(new ReminderHistoryStore());
		const now = Date.now();
		const later = note({ id: 'later', title: 'Dentist', reminder: now + 2 * DAY });
		const daily = note({
			id: 'daily',
			title: 'Stretch',
			reminder: now + HOUR,
			repeat: { every: 1, unit: 'day', zone: 'UTC' }
		});
		const gone = note({ id: 'gone', reminder: now - HOUR });
		const shelved = note({ id: 'shelved', reminder: now + HOUR, archived: true });
		await store.activateProfile(TEST_WORKSPACE, [later, daily, gone, shelved]);

		const upcoming = store.upcoming(now, now + 3 * DAY);
		expect(upcoming.map((item) => [item.noteId, item.at])).toEqual([
			['daily', now + HOUR],
			['daily', now + HOUR + DAY],
			['later', now + 2 * DAY],
			['daily', now + HOUR + 2 * DAY]
		]);
		expect(upcoming[0]).toMatchObject({
			workspaceId: TEST_WORKSPACE,
			title: 'Stretch',
			wakeId: reminderWakeId('daily', now + HOUR)
		});
	});

	it('hands the system only so many', async () => {
		const store = new ReminderStore(new ReminderHistoryStore());
		const now = Date.now();
		const notes = Array.from({ length: UPCOMING_LIMIT + 5 }, (_, n) =>
			note({ id: `n${n}`, reminder: now + (n + 1) * HOUR })
		);
		await store.activateProfile(TEST_WORKSPACE, notes);
		expect(store.upcoming(now)).toHaveLength(UPCOMING_LIMIT);
	});

	it('tells its watcher at once and again when the notes change', async () => {
		const store = new ReminderStore(new ReminderHistoryStore());
		const now = Date.now();
		await store.activateProfile(TEST_WORKSPACE, [note({ reminder: now + HOUR })]);
		const heard: number[][] = [];
		const stop = store.watchUpcoming((list) => heard.push(list.map((item) => item.at)));
		expect(heard).toEqual([[now + HOUR]]);

		store.sync([note({ reminder: now + 2 * HOUR })]);
		expect(heard.at(-1)).toEqual([now + 2 * HOUR]);

		stop();
		store.sync([note({ reminder: now + 3 * HOUR })]);
		expect(heard.at(-1)).toEqual([now + 2 * HOUR]);
	});

	it('opens the note a tapped system notification was about, or its workspace', async () => {
		const store = new ReminderStore(new ReminderHistoryStore());
		const shell = host();
		const stop = store.attach(shell);
		const at = Date.now() + HOUR;
		await store.activateProfile(TEST_WORKSPACE, [note({ reminder: at })]);

		store.openFromSystem({
			workspaceId: TEST_WORKSPACE,
			noteId: 'n1',
			wakeId: reminderWakeId('n1', at),
			reminder: at
		});
		expect(shell.opened).toEqual([[TEST_WORKSPACE, 'n1']]);

		store.openFromSystem({ workspaceId: TEST_WORKSPACE, noteId: '', wakeId: 'w', reminder: at });
		expect(shell.openedWorkspaces).toEqual([TEST_WORKSPACE]);
		stop();
	});
});
