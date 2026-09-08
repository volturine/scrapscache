<script lang="ts" module>
	/** Day filter state: a single day (from === to) or an inclusive range. `null` to = picking the end day. */
	export type ReminderDayFilter = { from: string; to: string | null };
</script>

<script lang="ts">
	import { DatePicker } from '@ark-ui/svelte/date-picker';
	import { parseDate, type DateValue } from '@internationalized/date';
	import DatePickerViews from './DatePickerViews.svelte';
	import type { Note } from '$lib/types';
	import { dayKey } from '$lib/utils';

	let {
		notes,
		selected = $bindable<ReminderDayFilter | null>(null)
	}: {
		notes: Note[];
		selected?: ReminderDayFilter | null;
	} = $props();

	const LONG_PRESS_MS = 450;
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressed = false;

	const pickingEnd = $derived(selected !== null && selected.to === null);
	const reminderDays = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const note of notes) {
			if (note.reminder == null) continue;
			const key = dayKey(note.reminder);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return counts;
	});
	const pickerValue = $derived.by((): DateValue[] => {
		if (!selected) return [];
		const from = parseDate(selected.from);
		if (selected.to == null) return [from];
		if (selected.from === selected.to) return [from, from];
		return [from, parseDate(selected.to)];
	});

	function startPress(day: DateValue) {
		longPressed = false;
		cancelPress();
		pressTimer = setTimeout(() => {
			pressTimer = null;
			longPressed = true;
			try {
				navigator.vibrate?.(10);
			} catch {}
			const key = day.toString();
			selected = { from: key, to: null };
		}, LONG_PRESS_MS);
	}

	function cancelPress() {
		if (pressTimer !== null) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	}

	function handleDayClick(day: DateValue, event?: MouseEvent) {
		cancelPress();
		if (longPressed) {
			longPressed = false;
			return;
		}
		const key = day.toString();
		if (event?.shiftKey && (!selected || selected.to !== null)) {
			selected = { from: key, to: null };
			return;
		}
		if (selected && selected.to === null) {
			selected =
				key < selected.from ? { from: key, to: selected.from } : { from: selected.from, to: key };
			return;
		}
		if (selected && selected.from === key && selected.to === key) {
			selected = null;
			return;
		}
		selected = { from: key, to: key };
	}

	function filterToday() {
		const key = dayKey(Date.now());
		if (selected && selected.to !== null && key >= selected.from && key <= selected.to) {
			selected = null;
			return;
		}
		selected = { from: key, to: key };
	}
</script>

<div
	class="reminder-calendar w-full select-none rounded-2xl border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] px-3 py-3"
>
	<DatePicker.Root
		class="w-full"
		inline
		startOfWeek={1}
		fixedWeeks
		selectionMode="range"
		value={pickerValue}
		closeOnSelect={false}
	>
		<DatePickerViews
			onDayClick={handleDayClick}
			onDayPointerDown={startPress}
			onDayPointerUp={cancelPress}
			onDayPointerLeave={cancelPress}
			onDayPointerCancel={cancelPress}
		>
			{#snippet dayExtra(day)}
				{@const count = reminderDays.get(day.toString()) ?? 0}
				{#if count > 0}
					<span
						class="absolute bottom-1 h-1 w-1 rounded-full bg-[var(--scrapscache-accent)] data-[selected]:bg-[var(--scrapscache-accent-foreground)]"
					></span>
				{/if}
			{/snippet}
		</DatePickerViews>
	</DatePicker.Root>

	<div
		class="mt-2 flex items-center justify-between gap-2 border-t border-[var(--scrapscache-border)] pt-3 text-xs"
	>
		<div class="flex flex-1 items-center">
			<button
				type="button"
				class="rounded-full px-2 py-0.5 font-medium leading-5 text-[var(--scrapscache-text-muted)] hover:bg-black/5 hover:text-[var(--scrapscache-text)] dark:hover:bg-white/10"
				onclick={filterToday}
			>
				Today
			</button>
		</div>
		<span class="shrink-0 truncate px-2 leading-5 text-[var(--scrapscache-text-muted)]">
			{#if pickingEnd}
				Pick an end day
			{:else if selected && selected.from !== selected.to}
				Range filter active
			{:else if selected}
				Day filter active
			{/if}
		</span>
		<div class="flex flex-1 items-center justify-end">
			<button
				type="button"
				class="rounded-full px-2 py-0.5 leading-5 text-[var(--scrapscache-text-muted)] hover:bg-black/5 hover:text-[var(--scrapscache-text)] disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-white/10"
				disabled={!selected}
				onclick={() => (selected = null)}
			>
				Clear
			</button>
		</div>
	</div>
</div>
