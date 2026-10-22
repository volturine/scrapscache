<script lang="ts" module>
	/** Day filter state: a single day (from === to) or an inclusive range. `null` to = picking the end day. */
	export type ReminderDayFilter = { from: string; to: string | null };
</script>

<script lang="ts">
	import { DatePicker, type DatePickerVisibleRangeChangeDetails } from '@ark-ui/svelte/date-picker';
	import { getLocalTimeZone, parseDate, type DateValue } from '@internationalized/date';
	import DatePickerViews from './DatePickerViews.svelte';
	import type { Note } from '#lib/types.js';
	import { dayKey, dayKeySpan } from '#lib/utils.js';
	import { reminderTimesBetween } from '#lib/model/index.js';
	import { truncate } from '$panda/styles';
	import { css, cx } from 'styled-system/css';
	import { flex, hstack } from 'styled-system/patterns';
	import { button } from 'styled-system/recipes';

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
	const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
	/** The days the calendar shows, with the week either side a fixed grid can reach into. */
	let shown = $state.raw<{ start: number; end: number } | null>(null);
	const range = $derived.by(() => {
		if (shown) return shown;
		const month = (selected?.from ?? dayKey(Date.now())).slice(0, 8);
		const { start } = dayKeySpan(`${month}01`);
		return { start: start - WEEK_MS, end: start + 31 * 24 * 60 * 60 * 1000 + WEEK_MS };
	});
	const reminderDays = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const note of notes) {
			if (note.reminder == null) continue;
			// A repeating reminder marks each day it comes on in view.
			const times = note.repeat
				? reminderTimesBetween(note, range.start, range.end, 62)
				: [note.reminder];
			for (const key of new Set(times.map(dayKey))) counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return counts;
	});

	function onVisibleRangeChange({ visibleRange }: DatePickerVisibleRangeChangeDetails) {
		const zone = getLocalTimeZone();
		shown = {
			start: visibleRange.start.toDate(zone).getTime() - WEEK_MS,
			end: visibleRange.end.toDate(zone).getTime() + 2 * WEEK_MS
		};
	}
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

	const footerBtnClass = cx(
		button({ variant: 'ghost' }),
		css({
			h: '2rem',
			rounded: 'pill',
			px: 'sm',
			fontSize: 'inherit',
			lineHeight: 'compact',
			_disabled: { opacity: 0.4, pointerEvents: 'none' }
		})
	);
</script>

<div
	class={[
		'reminder-calendar',
		css({
			w: 'full',
			userSelect: 'none',
			rounded: 'sheet',
			borderWidth: 'hairline',
			borderColor: 'scrapscache.border',
			bg: 'scrapscache.surface',
			px: 'md',
			py: 'md'
		})
	]}
>
	<DatePicker.Root
		class={css({ w: 'full' })}
		inline
		startOfWeek={1}
		fixedWeeks
		selectionMode="range"
		value={pickerValue}
		closeOnSelect={false}
		{onVisibleRangeChange}
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
						class={`reminder-dot ${css({
							position: 'absolute',
							bottom: '2xs',
							h: '0.25rem',
							w: '0.25rem',
							rounded: 'pill',
							bg: 'scrapscache.accent'
						})}`}
					></span>
				{/if}
			{/snippet}
		</DatePickerViews>
	</DatePicker.Root>

	<div
		class={hstack({
			mt: 'sm',
			justify: 'space-between',
			gap: 'sm',
			borderTopWidth: 'hairline',
			borderColor: 'scrapscache.border',
			pt: 'md',
			fontSize: 'label'
		})}
	>
		<div class={flex({ flex: '1', align: 'center' })}>
			<button type="button" class={footerBtnClass} onclick={filterToday}> Today </button>
		</div>
		<span
			class={cx(
				truncate,
				css({
					flexShrink: 0,
					px: 'sm',
					lineHeight: 'compact',
					color: 'scrapscache.textMuted'
				})
			)}
		>
			{#if pickingEnd}
				Pick an end day
			{:else if selected && selected.from !== selected.to}
				Range filter active
			{:else if selected}
				Day filter active
			{/if}
		</span>
		<div class={flex({ flex: '1', align: 'center', justify: 'flex-end' })}>
			<button
				type="button"
				class={footerBtnClass}
				disabled={!selected}
				onclick={() => (selected = null)}
			>
				Clear
			</button>
		</div>
	</div>
</div>
