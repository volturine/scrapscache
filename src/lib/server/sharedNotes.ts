import { getDb, type Db } from '$lib/server/db';

export const MIN_SHARE_LIFETIME_MS = 60_000; // 1 minute
export const MAX_SHARE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const DEFAULT_SHARE_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_CIPHERTEXT_LENGTH = 25 * 1024 * 1024; // 25 MB

export interface SharedNoteRecord {
	id: string;
	ciphertext: string;
	burnAfterReading: boolean;
	expiresAt: number;
}

export class SharedNotes {
	constructor(
		private readonly db: Db,
		private readonly createId: () => string = () => crypto.randomUUID()
	) {}

	async create(
		params: {
			ciphertext: string;
			burnAfterReading?: boolean;
			expiresInMs?: number;
		},
		now = Date.now()
	): Promise<{ id: string; expiresAt: number }> {
		if (typeof params.ciphertext !== 'string' || !params.ciphertext.trim()) {
			throw new Error('Ciphertext is required');
		}
		if (params.ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
			throw new Error('Ciphertext exceeds size limit');
		}

		const lifetime = Math.max(
			MIN_SHARE_LIFETIME_MS,
			Math.min(params.expiresInMs ?? DEFAULT_SHARE_LIFETIME_MS, MAX_SHARE_LIFETIME_MS)
		);
		const id = this.createId();
		const burnAfterReading = params.burnAfterReading ? 1 : 0;
		const expiresAt = now + lifetime;

		await this.db.ready;
		await this.db.ops.execute({
			sql: `INSERT INTO shared_notes (id, ciphertext, burn_after_reading, view_count, created_at, expires_at)
			      VALUES (?, ?, ?, 0, ?, ?)`,
			args: [id, params.ciphertext, burnAfterReading, now, expiresAt]
		});

		return { id, expiresAt };
	}

	async get(id: string, now = Date.now()): Promise<SharedNoteRecord | null> {
		await this.db.ready;

		// Check existence and expiration
		const statusResult = await this.db.ops.execute({
			sql: 'SELECT burn_after_reading AS burnAfterReading, expires_at AS expiresAt FROM shared_notes WHERE id = ?',
			args: [id]
		});

		const row = statusResult.rows[0] as unknown as
			{ burnAfterReading: number; expiresAt: number } | undefined;

		if (!row) return null;

		if (row.expiresAt <= now) {
			await this.db.ops.execute({
				sql: 'DELETE FROM shared_notes WHERE id = ?',
				args: [id]
			});
			return null;
		}

		if (row.burnAfterReading === 1) {
			// Atomically retrieve and delete for burn-after-reading notes
			const deleteResult = await this.db.ops.execute({
				sql: `DELETE FROM shared_notes
				      WHERE id = ? AND expires_at > ? AND burn_after_reading = 1
				      RETURNING ciphertext, expires_at AS expiresAt`,
				args: [id, now]
			});

			const deletedRow = deleteResult.rows[0] as unknown as
				{ ciphertext: string; expiresAt: number } | undefined;

			if (!deletedRow) return null;

			return {
				id,
				ciphertext: deletedRow.ciphertext,
				burnAfterReading: true,
				expiresAt: deletedRow.expiresAt
			};
		}

		// Non-burn note: increment view_count and return ciphertext
		const updateResult = await this.db.ops.execute({
			sql: `UPDATE shared_notes
			      SET view_count = view_count + 1
			      WHERE id = ? AND expires_at > ? AND burn_after_reading = 0
			      RETURNING ciphertext, expires_at AS expiresAt`,
			args: [id, now]
		});

		const updatedRow = updateResult.rows[0] as unknown as
			{ ciphertext: string; expiresAt: number } | undefined;

		if (!updatedRow) return null;

		return {
			id,
			ciphertext: updatedRow.ciphertext,
			burnAfterReading: false,
			expiresAt: updatedRow.expiresAt
		};
	}

	async pruneExpired(now = Date.now()): Promise<void> {
		await this.db.ready;
		await this.db.ops.execute({
			sql: 'DELETE FROM shared_notes WHERE expires_at <= ?',
			args: [now]
		});
	}
}

let singleton: SharedNotes | undefined;

export function getSharedNotes(): SharedNotes {
	singleton ??= new SharedNotes(getDb());
	return singleton;
}
