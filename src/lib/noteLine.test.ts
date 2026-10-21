import { describe, expect, it } from 'vitest';
import { plainLine } from './noteLine.js';

describe('plainLine', () => {
	it.each([
		['- [ ] Oat milk', 'Oat milk'],
		['[x] Oat milk', 'Oat milk'],
		['[] Oat milk', 'Oat milk'],
		['• Pastéis de Belém', 'Pastéis de Belém'],
		['* item', 'item'],
		['+ item', 'item'],
		['12) step', 'step'],
		['3. step', 'step'],
		['## Groceries', 'Groceries'],
		['> quoted', 'quoted'],
		['  plain text  ', 'plain text'],
		['#hashtag stays', '#hashtag stays']
	])('reads %j as %j', (line, expected) => {
		expect(plainLine(line)).toBe(expected);
	});
});
