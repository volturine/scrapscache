<script lang="ts">
	import { colorCheckmark as checkmark, colorSwatch as swatch, popover } from '$panda/styles';
	import { ToggleGroup } from '@ark-ui/svelte/toggle-group';
	import { NOTE_COLOR_ORDER, type NoteColor } from '$lib/types';
	import { cx } from 'styled-system/css';
	import { grid } from 'styled-system/patterns';
	import { noteSurface } from 'styled-system/recipes';

	let {
		color,
		onSelect
	}: {
		color: NoteColor;
		onSelect: (c: NoteColor) => void;
	} = $props();
</script>

<ToggleGroup.Root
	class={`${popover} ${grid({ columns: 4, gap: 'md', p: 'lg' })}`}
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
				<span class={checkmark()}>✓</span>
			{/if}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
