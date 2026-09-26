import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSyncOutboxKeys } from '$lib/db/idb';
import { CanvasLibraryStore } from './canvasLibrary';
import { syncStore } from './sync.svelte';

function item(id: string, name?: string) {
	return {
		id,
		status: 'unpublished',
		created: 1,
		elements: [{ id: `${id}-shape` }],
		...(name ? { name } : {})
	};
}

beforeEach(() => {
	vi.spyOn(syncStore, 'requestAutoSync').mockImplementation(() => undefined);
});

describe('workspace canvas library', () => {
	it('saves what the editor added and removed, and queues each for sync', async () => {
		const store = new CanvasLibraryStore();
		await store.hydrate('library-a');
		store.applyEditorChange([], [item('star'), item('box')]);
		store.applyEditorChange([item('star'), item('box')], [item('star')]);
		await store.waitForPendingWrites();

		expect(store.items().map((candidate) => candidate.id)).toEqual(['star']);
		expect((await getSyncOutboxKeys('library-a')).sort()).toEqual([
			'library-item-tombstone:box',
			'library-item:box',
			'library-item:star'
		]);

		const reloaded = new CanvasLibraryStore();
		await reloaded.hydrate('library-a');
		expect(reloaded.items()).toEqual([item('star')]);
		expect(reloaded.tombstonesForSync()).toHaveProperty('box');
	});

	it('keeps an item another device added while the editor was open', async () => {
		const store = new CanvasLibraryStore();
		await store.hydrate('library-b');
		const shown = [item('mine')];
		store.applyEditorChange([], shown);
		store.applySync([{ id: 'theirs', updatedAt: Date.now(), item: item('theirs') }], {});

		// The editor never showed `theirs`, so its next report is not a delete of it.
		store.applyEditorChange(shown, [item('mine', 'renamed')]);

		expect(
			store
				.items()
				.map((candidate) => candidate.id)
				.sort()
		).toEqual(['mine', 'theirs']);
		expect(store.tombstonesForSync()).toEqual({});
	});

	it('tells an open editor about changes that came from another device', async () => {
		const store = new CanvasLibraryStore();
		await store.hydrate('library-c');
		const heard: string[][] = [];
		store.subscribe((items) => heard.push(items.map((candidate) => candidate.id)));
		store.applySync([{ id: 'theirs', updatedAt: 5, item: item('theirs') }], {});
		store.applySync([], { theirs: 6 });
		expect(heard).toEqual([['theirs'], []]);
	});

	it('does not carry one workspace library into another', async () => {
		const store = new CanvasLibraryStore();
		await store.hydrate('library-d');
		store.applyEditorChange([], [item('star')]);
		await store.waitForPendingWrites();
		await store.hydrate('library-e');
		expect(store.items()).toEqual([]);
		expect(await getSyncOutboxKeys('library-e')).toEqual([]);
	});
});
