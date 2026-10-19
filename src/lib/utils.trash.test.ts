import { describe, expect, it } from 'vitest';
import { trashCountdown } from './utils';

// Local wall clock: trashed Sat Oct 10 2026, 10:00, so it is deleted Sat Oct 17 at 10:00.
const trashedAt = new Date(2026, 9, 10, 10, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).getTime();

describe('trashCountdown', () => {
	it('has no countdown for a note without a trash date', () => {
		expect(trashCountdown(null, at(10, 10))).toBeNull();
	});

	it('shows the full purge window right after trashing', () => {
		expect(trashCountdown(trashedAt, at(10, 10))).toEqual({
			label: 'Deletes in 7 days',
			soon: false
		});
	});

	it('counts whole calendar days', () => {
		expect(trashCountdown(trashedAt, at(15, 10))).toEqual({
			label: 'Deletes in 2 days',
			soon: false
		});
	});

	it('says tomorrow on the day before deletion', () => {
		expect(trashCountdown(trashedAt, at(16, 10))).toEqual({
			label: 'Deletes tomorrow',
			soon: true
		});
	});

	it('says today on the deletion day before the deadline hour', () => {
		expect(trashCountdown(trashedAt, at(17, 9))).toEqual({ label: 'Deletes today', soon: true });
	});

	it('still says today past the deadline hour', () => {
		expect(trashCountdown(trashedAt, at(17, 12))).toEqual({ label: 'Deletes today', soon: true });
	});
});
