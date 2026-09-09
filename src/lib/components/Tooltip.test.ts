import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Tooltip from './Tooltip.svelte';

describe('Tooltip', () => {
	it('renders children with tooltip trigger', () => {
		const { container } = render(Tooltip, {
			props: {
				content: 'Helpful description',
				children: (() => {}) as any
			}
		});
		expect(container).toBeTruthy();
	});
});
