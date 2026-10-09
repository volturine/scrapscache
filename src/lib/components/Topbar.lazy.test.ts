import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigationMocks = vi.hoisted(() => ({ goto: vi.fn() }));
// Sync, backup and Keep import load their code on demand; `chunk.missing`
// stands in for a deploy that no longer serves it, after a reload did not help.
const chunk = vi.hoisted(() => ({ missing: false }));

vi.mock('$app/navigation', () => navigationMocks);
vi.mock('#lib/editorContext.js', () => ({
	useEditorActions: () => ({ startNewNote: vi.fn(), closeNote: vi.fn() })
}));
vi.mock('#lib/staleModuleReload.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/staleModuleReload.js')>();
	return {
		...actual,
		loadLazyModule: <T>(load: () => Promise<T>) =>
			chunk.missing
				? Promise.reject(new Error(actual.STALE_MODULE_MESSAGE))
				: actual.loadLazyModule(load)
	};
});

import { STALE_MODULE_MESSAGE } from '#lib/staleModuleReload.js';
import Topbar from './Topbar.svelte';

async function chooseMenuItem(name: string) {
	await fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
	const item = await screen.findByRole('menuitem', { name });
	await fireEvent.pointerDown(item, { pointerType: 'mouse' });
	await fireEvent.click(item);
}

describe('Topbar when on-demand code fails to load', () => {
	afterEach(() => {
		chunk.missing = false;
		vi.restoreAllMocks();
	});

	it('tells the person to reload instead of leaving the sync dialog closed', async () => {
		chunk.missing = true;
		render(Topbar);
		await fireEvent.click(screen.getByRole('button', { name: 'Sync settings' }));

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain(STALE_MODULE_MESSAGE);
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
	});

	it('shows the same message in the backup dialog', async () => {
		chunk.missing = true;
		render(Topbar);
		await chooseMenuItem('Export backup');
		await fireEvent.input(await screen.findByLabelText('Backup passphrase'), {
			target: { value: 'a strong passphrase' }
		});
		await fireEvent.input(screen.getByLabelText('Confirm passphrase'), {
			target: { value: 'a strong passphrase' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Export backup' }));

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain(STALE_MODULE_MESSAGE);
	});
});
