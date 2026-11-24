import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditSession, notePutAway } from './editSession';
import { notesStore } from './notes.svelte';
import { relaySync, syncStore } from './sync.svelte';
import { syncScheduler } from './syncScheduler';

describe('when a note is sent because of what was done with it', () => {
	let ended: ReturnType<typeof vi.fn>;
	let begin: ReturnType<typeof vi.spyOn>;
	let flush: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		ended = vi.fn();
		begin = vi.spyOn(relaySync, 'beginEditSession').mockReturnValue(ended as () => void);
		flush = vi.spyOn(syncScheduler, 'flush').mockResolvedValue(true);
	});

	afterEach(() => vi.restoreAllMocks());

	it('sends what the open workspace has queued when a note is put away', async () => {
		expect(await notePutAway()).toBe(true);
		expect(flush).toHaveBeenCalledWith(syncStore.activeId);
	});

	it('ends an editor’s version only after its last upload was asked for', async () => {
		let sent: (value: boolean) => void = () => undefined;
		flush.mockReturnValue(new Promise<boolean>((resolve) => (sent = resolve)));
		const session = new EditSession('note-1');
		expect(begin).toHaveBeenCalledWith('note-1');

		session.close();
		expect(flush).toHaveBeenCalledOnce();
		expect(ended).not.toHaveBeenCalled();

		sent(true);
		await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
	});

	it('ends the version without sending when the editor went away', () => {
		new EditSession('note-1').drop();

		expect(ended).toHaveBeenCalledOnce();
		expect(flush).not.toHaveBeenCalled();
	});

	it('starts another version for what is changed after a cut', () => {
		const session = new EditSession('note-1');

		session.cut('note-1');

		expect(ended).toHaveBeenCalledOnce();
		expect(begin).toHaveBeenCalledTimes(2);
	});

	it('holds no version for an editor without a note, and still sends', async () => {
		const session = new EditSession(null);
		expect(begin).not.toHaveBeenCalled();

		await session.send();
		expect(flush).toHaveBeenCalledOnce();
	});

	it('sends a reminder change at once, for one note or many', () => {
		const request = vi.spyOn(syncScheduler, 'request').mockResolvedValue(true);
		const note = notesStore.createNote({ title: 'Reminded' });

		notesStore.setReminder(note.id, Date.now() + 60_000);
		expect(request).toHaveBeenCalledWith(syncStore.activeId);

		request.mockClear();
		notesStore.setReminderMany([note.id], null);
		expect(request).toHaveBeenCalledOnce();
	});
});
