import { describe, it, expect } from 'vitest';
import {
	encryptSharedNote,
	decryptSharedNote,
	generateShareKey,
	createShareUrl,
	parseShareHash
} from './shareCrypto';
import type { Note } from './types';

describe('shareCrypto', () => {
	const sampleNote: Note = {
		id: 'test-id',
		title: 'Secret Meeting',
		body: '- [x] Confirm venue\n- [ ] Send invites\nSecret details here.',
		color: 'green',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1700000000000,
		updatedAt: 1700000010000,
		reminder: null,
		labels: ['label-1'],
		images: [
			{
				id: 'img-1',
				name: 'photo.jpg',
				mime: 'image/jpeg',
				dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
				createdAt: 1700000000000
			}
		],
		linkPreviews: [
			{
				url: 'https://example.com',
				title: 'Example Domain',
				description: 'Example Description',
				hostname: 'example.com'
			}
		]
	};

	it('encrypts and decrypts note data with round-trip fidelity', () => {
		const labelNames = ['Work', 'Projects'];
		const { ciphertext, key } = encryptSharedNote(sampleNote, labelNames);

		expect(typeof ciphertext).toBe('string');
		expect(typeof key).toBe('string');
		expect(key.length).toBeGreaterThan(40);

		// Ciphertext should not contain plaintext
		expect(ciphertext).not.toContain('Secret Meeting');
		expect(ciphertext).not.toContain('Confirm venue');
		expect(ciphertext).not.toContain('photo.jpg');

		const decrypted = decryptSharedNote(ciphertext, key);

		expect(decrypted.version).toBe(1);
		expect(decrypted.title).toBe(sampleNote.title);
		expect(decrypted.body).toBe(sampleNote.body);
		expect(decrypted.color).toBe(sampleNote.color);
		expect(decrypted.images).toHaveLength(1);
		expect(decrypted.images?.[0].dataUrl).toBe(sampleNote.images?.[0].dataUrl);
		expect(decrypted.linkPreviews).toEqual(sampleNote.linkPreviews);
		expect(decrypted.labelNames).toEqual(labelNames);
		expect(decrypted.createdAt).toBe(sampleNote.createdAt);
	});

	it('fails decryption with wrong key', () => {
		const { ciphertext } = encryptSharedNote(sampleNote);
		const wrongKey = generateShareKey();

		expect(() => decryptSharedNote(ciphertext, wrongKey)).toThrow();
	});

	it('fails decryption if ciphertext is tampered with', () => {
		const { ciphertext, key } = encryptSharedNote(sampleNote);
		// Mutate a character in ciphertext
		const tampered =
			ciphertext.slice(0, 10) + (ciphertext[10] === 'A' ? 'B' : 'A') + ciphertext.slice(11);

		expect(() => decryptSharedNote(tampered, key)).toThrow();
	});

	it('creates and parses share URLs correctly', () => {
		const key = generateShareKey();
		const url = createShareUrl('https://scrapscache.app', 'share-uuid-123', key);

		expect(url).toBe(`https://scrapscache.app/share/share-uuid-123#${key}`);

		const parsed = parseShareHash(`#${key}`);
		expect(parsed).toBe(key);

		const parsedWithoutHash = parseShareHash(key);
		expect(parsedWithoutHash).toBe(key);

		expect(parseShareHash('')).toBeNull();
		expect(parseShareHash('#short')).toBeNull();
		expect(parseShareHash('#invalid!characters$in^key')).toBeNull();
	});
});
