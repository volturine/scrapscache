<script lang="ts">
	import { ToggleGroup } from '@ark-ui/svelte/toggle-group';
	import { NOTE_COLORS, NOTE_DARK_COLORS, NOTE_COLOR_ORDER, type NoteColor } from '$lib/types';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { css } from 'styled-system/css';
	import { grid } from 'styled-system/patterns';

	let {
		color,
		onSelect
	}: {
		color: NoteColor;
		onSelect: (c: NoteColor) => void;
	} = $props();

	function bgColor(c: NoteColor): string {
		return uiStore.effectiveDark ? NOTE_DARK_COLORS[c] : NOTE_COLORS[c];
	}
</script>

<ToggleGroup.Root
	class={`scrapscache-popover ${grid({ columns: 4, gap: '0.75rem', p: '1rem' })}`}
	value={[color]}
	onValueChange={(details) => {
		const next = details.value[0];
		if (next) onSelect(next as NoteColor);
	}}
>
	{#each NOTE_COLOR_ORDER as c (c)}
		<ToggleGroup.Item
			value={c}
			class={css({
				w: '2.5rem',
				h: '2.5rem',
				rounded: 'full',
				borderWidth: '2px',
				borderColor: { base: 'black/10', _dark: 'white/15' },
				cursor: 'pointer',
				transition: 'transform 150ms ease',
				_motionReduce: {
					transition: 'none'
				},
				sm: {
					_hover: {
						transform: 'scale(1.1)'
					}
				}
			})}
			style="background-color: {bgColor(c)}"
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
						color: { base: 'black/60', _dark: 'white/70' }
					})}>✓</span
				>
			{/if}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
