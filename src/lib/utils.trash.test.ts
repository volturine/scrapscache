// Pinned so the DST case below runs the same on a UTC CI machine; the other cases
// use local dates and hold in any zone.
process.env.TZ = 'Europe/Bratislava';

import { describe, expect, it } from 'vitest';
import { trashCountdown, trashPurgeAt } from './utils';

const DAY = 86_400_000;
// Local wall clock: trashed Sat Oct 10 2026, 10:00, so it is deleted Sat Oct 17 at 10:00.
const trashedAt = new Date(2026, 9, 10, 10, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).getTime();

describe('trashPurgeAt', () => {
	it('is seven days after the note was trashed', () => {
		expect(trashPurgeAt(trashedAt)).toBe(trashedAt + 7 * DAY);
	});

	it('is due now for a missing or unusable trash time', () => {
		expect(trashPurgeAt(null)).toBe(0);
		expect(trashPurgeAt(Number.NaN)).toBe(0);
		expect(trashPurgeAt('2026-10-10T10:00:00Z' as unknown as number)).toBe(0);
	});
});

describe('trashCountdown', () => {
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

	it('says today on the deletion day, before and after the deadline hour', () => {
		expect(trashCountdown(trashedAt, at(17, 9))).toEqual({ label: 'Deletes today', soon: true });
		expect(trashCountdown(trashedAt, at(17, 12))).toEqual({ label: 'Deletes today', soon: true });
	});

	it('still says today for a note several days overdue', () => {
		expect(trashCountdown(trashedAt, at(21, 10))).toEqual({ label: 'Deletes today', soon: true });
	});

	it('agrees with the purge on a missing or unusable trash time', () => {
		for (const broken of [null, Number.NaN]) {
			expect(trashCountdown(broken, at(10, 10))).toEqual({ label: 'Deletes today', soon: true });
		}
	});

	it('counts calendar days across a change of clocks', () => {
		// Bratislava leaves summer time on Sun Oct 25 2026, so the 168 hours from
		// Sat Oct 24 00:30 end on Fri Oct 30 at 23:30: six calendar days later.
		const beforeChange = new Date(2026, 9, 24, 0, 30).getTime();

		expect(new Date(trashPurgeAt(beforeChange)).getDate()).toBe(30);
		expect(trashCountdown(beforeChange, beforeChange)).toEqual({
			label: 'Deletes in 6 days',
			soon: false
		});
	});
});
