<script lang="ts">
	import { ToggleGroup } from '@ark-ui/svelte/toggle-group';
	import { NOTE_COLORS, NOTE_DARK_COLORS, NOTE_COLOR_ORDER, type NoteColor } from '$lib/types';
	import { uiStore } from '$lib/stores/ui.svelte';

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
	class="scrapscache-popover grid grid-cols-4 gap-3 p-4"
	value={[color]}
	onValueChange={(details) => {
		const next = details.value[0];
		if (next) onSelect(next as NoteColor);
	}}
>
	{#each NOTE_COLOR_ORDER as c (c)}
		<ToggleGroup.Item
			value={c}
			class="h-10 w-10 rounded-full border-2 border-black/10 transition-transform motion-reduce:transition-none sm:hover:scale-110 dark:border-white/15"
			style="background-color: {bgColor(c)}"
			aria-label="Set color {c}"
			title={c}
		>
			{#if c === color}
				<span
					class="flex h-full w-full items-center justify-center text-sm text-black/60 dark:text-white/70"
					>✓</span
				>
			{/if}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
