import { describe, expect, it } from 'vitest';
import { noteActivity } from './utils';

// Local wall clock: Tue Sep 15 2026, 14:30.
const now = new Date(2026, 8, 15, 14, 30, 0, 0).getTime();

describe('noteActivity', () => {
	it('labels a never-edited note as Created', () => {
		const at = now - 5_000;
		const activity = noteActivity({ createdAt: at, updatedAt: at }, now);

		expect(activity.label).toBe('Created just now');
		expect(activity.at).toBe(at);
		expect(activity.detail).toMatch(/^Created /);
		expect(activity.detail).not.toMatch(/Edited/);
		expect(activity.detail).not.toMatch(/Deleted/);
	});

	it('labels an edited note as Edited with both absolutes in the detail', () => {
		const activity = noteActivity(
			{ createdAt: now - 3 * 86_400_000, updatedAt: now - 120_000 },
			now
		);

		expect(activity.label).toBe('Edited 2m ago');
		expect(activity.at).toBe(now - 120_000);
		expect(activity.detail).toMatch(/^Created /);
		expect(activity.detail).toMatch(/ · Edited /);
	});

	it('treats updatedAt before createdAt as never edited', () => {
		const activity = noteActivity({ createdAt: now - 60_000, updatedAt: now - 120_000 }, now);

		expect(activity.label).toBe('Created 1m ago');
		expect(activity.detail).not.toMatch(/Edited/);
	});

	it('labels a trashed note as Deleted from trashedAt', () => {
		const activity = noteActivity(
			{
				createdAt: now - 10 * 86_400_000,
				updatedAt: now - 86_400_000,
				trashed: true,
				trashedAt: now - 2 * 3_600_000
			},
			now
		);

		expect(activity.label).toBe('Deleted 2h ago');
		expect(activity.at).toBe(now - 2 * 3_600_000);
		expect(activity.detail).toMatch(/ · Deleted /);
	});

	it('falls back to updatedAt when a trashed note has no trashedAt', () => {
		const activity = noteActivity(
			{ createdAt: now - 86_400_000, updatedAt: now - 45_000, trashed: true, trashedAt: null },
			now
		);

		expect(activity.label).toBe('Deleted just now');
		expect(activity.at).toBe(now - 45_000);
	});

	it('uses minutes under an hour', () => {
		expect(noteActivity({ createdAt: 1, updatedAt: now - 45 * 60_000 }, now).label).toBe(
			'Edited 45m ago'
		);
	});

	it('uses hours within the same calendar day', () => {
		expect(noteActivity({ createdAt: 1, updatedAt: now - 3 * 3_600_000 }, now).label).toBe(
			'Edited 3h ago'
		);
	});

	it('uses Yesterday for the previous calendar day', () => {
		const yesterday = new Date(2026, 8, 14, 9, 0).getTime();
		expect(noteActivity({ createdAt: 1, updatedAt: yesterday }, now).label).toBe(
			'Edited Yesterday'
		);
	});

	it('uses a short date within the same year', () => {
		const earlier = new Date(2026, 8, 1, 9, 0).getTime();
		expect(noteActivity({ createdAt: 1, updatedAt: earlier }, now).label).toBe('Edited Sep 1');
	});

	it('includes the year for notes from a previous year', () => {
		const older = new Date(2025, 11, 1, 9, 0).getTime();
		expect(noteActivity({ createdAt: 1, updatedAt: older }, now).label).toBe('Edited Dec 1, 2025');
	});
});
