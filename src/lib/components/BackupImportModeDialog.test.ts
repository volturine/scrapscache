import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BackupImportModeDialog from './BackupImportModeDialog.svelte';

describe('BackupImportModeDialog', () => {
	it('offers additive and replacement import modes explicitly', async () => {
		const onSelect = vi.fn();
		render(BackupImportModeDialog, { props: { onSelect, onClose: vi.fn() } });

		await fireEvent.click(screen.getByRole('button', { name: /keep local notes/i }));
		await fireEvent.click(screen.getByRole('button', { name: /replace local data/i }));

		expect(onSelect).toHaveBeenNthCalledWith(1, 'keep');
		expect(onSelect).toHaveBeenNthCalledWith(2, 'replace');
	});

	it('does not cover the page with a click-catching overlay while closed', () => {
		render(BackupImportModeDialog, {
			props: { open: false, onSelect: vi.fn(), onClose: vi.fn() }
		});
		expect(document.querySelector('[role="presentation"]')).toBeNull();
	});

	it('names Keep notes when importing a Takeout', () => {
		render(BackupImportModeDialog, {
			props: { keepImport: true, onSelect: vi.fn(), onClose: vi.fn() }
		});

		expect(screen.getByRole('heading', { name: /keep notes/i })).toBeTruthy();
		expect(screen.getByText(/add every keep note as a new copy/i)).toBeTruthy();
	});
});
