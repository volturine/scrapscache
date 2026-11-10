import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloadFile = vi.hoisted(() => vi.fn());
const shareFile = vi.hoisted(() => vi.fn(async () => undefined));
const isNativeApp = vi.hoisted(() => vi.fn(() => false));

vi.mock('@zag-js/file-utils', () => ({ downloadFile }));
vi.mock('#lib/native/shareFile.js', () => ({ shareFile }));
vi.mock('#lib/native.js', () => ({ isNativeApp }));

import { saveFile } from './saveFile.js';

beforeEach(() => {
	vi.clearAllMocks();
	isNativeApp.mockReturnValue(false);
});

describe('saveFile', () => {
	it('downloads the file on the web', async () => {
		const file = new Blob(['{}'], { type: 'application/json' });

		await saveFile(file, 'backup.json');

		expect(downloadFile).toHaveBeenCalledWith({
			file,
			name: 'backup.json',
			type: 'application/json',
			revokeTimeout: 60_000
		});
		expect(shareFile).not.toHaveBeenCalled();
	});

	it('hands the file to the share sheet in the app, and reports its failure', async () => {
		isNativeApp.mockReturnValue(true);
		const file = new Blob(['{}'], { type: 'application/json' });

		await saveFile(file, 'backup.json');
		expect(shareFile).toHaveBeenCalledWith(file, 'backup.json');
		expect(downloadFile).not.toHaveBeenCalled();

		shareFile.mockRejectedValueOnce(new Error('No room left'));
		await expect(saveFile(file, 'backup.json')).rejects.toThrow('No room left');
	});
});
