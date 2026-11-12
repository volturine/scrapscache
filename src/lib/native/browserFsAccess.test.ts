import { beforeEach, describe, expect, it, vi } from 'vitest';

const share = vi.hoisted(() => ({ shareFile: vi.fn(async (_file: Blob, _name: string) => true) }));
vi.mock('./shareFile.js', () => share);

import { fileOpen, fileSave } from './browserFsAccess.js';

beforeEach(() => {
	share.shareFile.mockReset();
	share.shareFile.mockResolvedValue(true);
});

describe('saving a file from a drawing in the iPhone app', () => {
	it('hands the file to the share sheet under the name it was to be saved by', async () => {
		const drawing = new Blob(['{}'], { type: 'application/vnd.excalidraw+json' });
		await expect(
			fileSave(drawing, { fileName: 'Plan.excalidraw', extensions: ['.excalidraw'] })
		).resolves.toBeNull();
		expect(share.shareFile).toHaveBeenCalledWith(drawing, 'Plan.excalidraw');
	});

	it('takes a file that is still being made, or a response, as the package does', async () => {
		const image = new Blob(['png']);
		await fileSave(Promise.resolve(image), [{ fileName: 'Plan.png' }, { extensions: ['.svg'] }]);
		expect(share.shareFile).toHaveBeenLastCalledWith(image, 'Plan.png');
		await fileSave(new Response('svg'));
		const [file, name] = share.shareFile.mock.calls[1];
		expect(await file.text()).toBe('svg');
		expect(name).toBe('Untitled');
	});

	it('reports a closed share sheet as an aborted save, so nothing claims the file was saved', async () => {
		share.shareFile.mockResolvedValue(false);
		await expect(fileSave(new Blob(['{}']), { fileName: 'Plan.excalidraw' })).rejects.toMatchObject(
			{ name: 'AbortError' }
		);
	});

	it('reports a share that failed', async () => {
		share.shareFile.mockRejectedValue(new Error('Error sharing item'));
		await expect(fileSave(new Blob(['{}']))).rejects.toThrow('Error sharing item');
	});

	it('leaves opening a file to the package', async () => {
		const real = await import('browser-fs-access');
		expect(fileOpen).toBe(real.fileOpen);
	});
});
