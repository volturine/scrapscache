<script lang="ts">
	import { ToggleGroup } from '@ark-ui/svelte/toggle-group';
	import { NOTE_COLOR_ORDER, type NoteColor } from '$lib/types';
	import { css, cva, cx } from 'styled-system/css';
	import { grid } from 'styled-system/patterns';
	import { noteSurface, popover } from 'styled-system/recipes';

	let {
		color,
		onSelect
	}: {
		color: NoteColor;
		onSelect: (c: NoteColor) => void;
	} = $props();

	const swatch = cva({
		base: {
			w: '2.5rem',
			h: '2.5rem',
			rounded: 'full',
			borderWidth: '2px',
			borderColor: 'scrapscache.borderSubtle',
			cursor: 'pointer',
			transition: 'transform 150ms ease',
			_motionReduce: {
				transition: 'none'
			},
			sm: {
				_hoverable: {
					transform: 'scale(1.1)'
				}
			}
		}
	});
</script>

<ToggleGroup.Root
	class={`${popover()} ${grid({ columns: 4, gap: '0.75rem', p: '1rem' })}`}
	value={[color]}
	onValueChange={(details) => {
		const next = details.value[0];
		if (next) onSelect(next as NoteColor);
	}}
>
	{#each NOTE_COLOR_ORDER as c (c)}
		<ToggleGroup.Item
			value={c}
			class={cx(swatch(), noteSurface({ color: c }))}
			aria-label="Set color {c}"
			title={c}
		>
			{#if c === color}
				<span
					class={css({
						display: 'flex',
						h: 'full',
						w: 'full',
						alignItems: 'center',
						justifyContent: 'center',
						fontSize: 'sm',
						color: 'scrapscache.textMuted'
					})}>✓</span
				>
			{/if}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
