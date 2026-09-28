import { describe, expect, it } from 'vitest';
import { fitDownloadPage } from './syncLimits';

const sized = (...sizes: number[]) => sizes.map((bytes, index) => ({ index, bytes }));
const fit = (rows: { index: number; bytes: number }[], countLimit: number, byteLimit: number) => {
	const { page, hasMore } = fitDownloadPage(rows, countLimit, byteLimit, (row) => row.bytes);
	return { indexes: page.map((row) => row.index), hasMore };
};

describe('fitDownloadPage', () => {
	it('stops at the count limit when every row is small', () => {
		expect(fit(sized(1, 1, 1, 1), 3, 100)).toEqual({ indexes: [0, 1, 2], hasMore: true });
	});

	it('stops before the row that would overflow the byte budget', () => {
		expect(fit(sized(40, 40, 40, 1), 10, 100)).toEqual({ indexes: [0, 1], hasMore: true });
	});

	it('fills the byte budget exactly', () => {
		expect(fit(sized(50, 50), 10, 100)).toEqual({ indexes: [0, 1], hasMore: false });
	});

	it('still sends one row larger than the whole budget, alone', () => {
		expect(fit(sized(500, 1), 10, 100)).toEqual({ indexes: [0], hasMore: true });
	});

	it('reports no more rows when every candidate fits', () => {
		expect(fit(sized(1, 1), 3, 100)).toEqual({ indexes: [0, 1], hasMore: false });
		expect(fit([], 3, 100)).toEqual({ indexes: [], hasMore: false });
	});
});
