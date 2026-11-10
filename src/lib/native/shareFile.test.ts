import { beforeEach, describe, expect, it, vi } from 'vitest';

type Written = { path: string; directory: string; data: string };

const filesystem = vi.hoisted(() => ({
	writeFile: vi.fn(async (_file: Written) => ({ uri: '' })),
	appendFile: vi.fn(async (_file: Written) => undefined),
	getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///cache/${path}` })),
	rmdir: vi.fn(async () => undefined)
}));
const share = vi.hoisted(() => ({ share: vi.fn(async () => ({})) }));

vi.mock('@capacitor/filesystem', () => ({
	Directory: { Cache: 'CACHE' },
	Filesystem: filesystem
}));
vi.mock('@capacitor/share', () => ({ Share: share }));

import { fileName, shareFile } from './shareFile.js';

const decode = (data: string) => Buffer.from(data, 'base64');

beforeEach(() => {
	vi.clearAllMocks();
	share.share.mockResolvedValue({});
});

describe('shareFile', () => {
	it('writes the file to the cache, shares it by its name, and removes it', async () => {
		await shareFile(new Blob(['hello'], { type: 'text/plain' }), 'note.txt');

		const written = filesystem.writeFile.mock.calls[0][0];
		expect(written.path).toMatch(/^share\/[^/]+\/note\.txt$/);
		expect(written.directory).toBe('CACHE');
		expect(decode(written.data).toString()).toBe('hello');
		expect(filesystem.appendFile).not.toHaveBeenCalled();
		expect(share.share).toHaveBeenCalledWith({ files: [`file:///cache/${written.path}`] });
		expect(filesystem.rmdir).toHaveBeenCalledWith({
			path: written.path.slice(0, written.path.lastIndexOf('/')),
			directory: 'CACHE',
			recursive: true
		});
	});

	it('sends a large file across in pieces that join to the same bytes', async () => {
		const bytes = Buffer.alloc(2 * 1024 * 1024 + 5);
		for (let i = 0; i < bytes.length; i += 4099) bytes[i] = i % 251;

		await shareFile(new Blob([bytes]), 'backup.scraps-cache-backup');

		const parts = [...filesystem.writeFile.mock.calls, ...filesystem.appendFile.mock.calls].map(
			([part]) => decode(part.data)
		);
		expect(parts.length).toBe(3);
		// Buffer.equals, not toEqual: a deep compare of two million bytes outlasts the test's time.
		expect(Buffer.concat(parts).equals(bytes)).toBe(true);
	});

	it('takes a closed sheet as no error, and still removes the file', async () => {
		share.share.mockRejectedValue(new Error('Share canceled'));

		await expect(shareFile(new Blob(['x']), 'a.txt')).resolves.toBeUndefined();
		expect(filesystem.rmdir).toHaveBeenCalledTimes(1);
	});

	it('reports a share that failed, and still removes the file', async () => {
		share.share.mockRejectedValue(new Error('Error sharing item'));

		await expect(shareFile(new Blob(['x']), 'a.txt')).rejects.toThrow('Error sharing item');
		expect(filesystem.rmdir).toHaveBeenCalledTimes(1);
	});
});

describe('fileName', () => {
	it('keeps a name to one path segment', () => {
		expect(fileName('photo.webp')).toBe('photo.webp');
		expect(fileName('../a/b:c.png')).toBe('..-a-b-c.png');
		expect(fileName('  ')).toBe('file');
		expect(fileName('..')).toBe('file');
	});
});
