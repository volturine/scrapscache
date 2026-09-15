import { describe, expect, it } from 'vitest';
import {
	decryptBackup,
	encryptBackup,
	isEncryptedScrapsCacheBackup,
	type BackupEncryptionOptions
} from './backupCrypto';

const fast: BackupEncryptionOptions = {
	memoryKiB: 8 * 1024,
	iterations: 2,
	parallelism: 1,
	chunkBytes: 1024
};

describe('encrypted Scraps Cache backups', () => {
	it('round-trips multiple authenticated chunks', async () => {
		const source = { notes: [{ id: 'one', body: 'private '.repeat(500) }], labels: [] };
		const encrypted = await encryptBackup(source, 'a strong backup passphrase', fast);
		expect(isEncryptedScrapsCacheBackup(encrypted)).toBe(true);
		expect(encrypted.chunks.length).toBeGreaterThan(1);
		await expect(decryptBackup(encrypted, 'a strong backup passphrase')).resolves.toEqual(source);
	});

	it('rejects an incorrect passphrase and modified ciphertext', async () => {
		const encrypted = await encryptBackup({ notes: [], labels: [] }, 'correct passphrase', fast);
		await expect(decryptBackup(encrypted, 'wrong passphrase')).rejects.toThrow(
			'incorrect or the file is damaged'
		);

		const ciphertext = encrypted.chunks[0].ciphertext;
		encrypted.chunks[0].ciphertext = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;
		await expect(decryptBackup(encrypted, 'correct passphrase')).rejects.toThrow(
			'incorrect or the file is damaged'
		);
	});

	it('rejects missing or reordered chunks', async () => {
		const encrypted = await encryptBackup({ body: 'x'.repeat(3000) }, 'correct passphrase', fast);
		const missing = { ...encrypted, chunks: encrypted.chunks.slice(1) };
		await expect(decryptBackup(missing, 'correct passphrase')).rejects.toThrow('incomplete');

		const reordered = { ...encrypted, chunks: [...encrypted.chunks].reverse() };
		await expect(decryptBackup(reordered, 'correct passphrase')).rejects.toThrow(
			'incorrect or the file is damaged'
		);
	});

	it('refuses key settings weaker than the accepted floor', async () => {
		const encrypted = await encryptBackup({ notes: ['secret'] }, 'correct passphrase', fast);
		for (const weak of [{ memoryKiB: 8 }, { iterations: 1 }]) {
			const downgraded = { ...encrypted, kdf: { ...encrypted.kdf, ...weak } };
			await expect(decryptBackup(downgraded, 'correct passphrase')).rejects.toThrow(
				'unsafe key settings'
			);
		}
		await expect(
			encryptBackup({ notes: [] }, 'correct passphrase', { ...fast, memoryKiB: 8 })
		).rejects.toThrow('unsafe key settings');
	});

	it('authenticates key settings in the backup header', async () => {
		const encrypted = await encryptBackup({ notes: ['secret'] }, 'correct passphrase', fast);
		const changedHeader = {
			...encrypted,
			kdf: { ...encrypted.kdf, iterations: encrypted.kdf.iterations + 1 }
		};
		await expect(decryptBackup(changedHeader, 'correct passphrase')).rejects.toThrow(
			'incorrect or the file is damaged'
		);
	});
});
