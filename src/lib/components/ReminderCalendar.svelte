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
	import { css } from 'styled-system/css';

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

	const containerClass = css({
		w: 'full',
		userSelect: 'none',
		rounded: '2xl',
		borderWidth: '1px',
		borderColor: 'scrapscache.border',
		bg: 'scrapscache.surface',
		px: '0.75rem',
		py: '0.75rem'
	});

	const pickerRootClass = css({
		w: 'full'
	});

	const dotClass = css({
		position: 'absolute',
		bottom: '0.25rem',
		h: '0.25rem',
		w: '0.25rem',
		rounded: 'full',
		bg: 'scrapscache.accent'
	});

	const footerClass = css({
		mt: '0.5rem',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '0.5rem',
		borderTopWidth: '1px',
		borderColor: 'scrapscache.border',
		pt: '0.75rem',
		fontSize: 'xs'
	});

	const footerSideClass = css({
		display: 'flex',
		flex: '1',
		alignItems: 'center'
	});

	const footerEndClass = css({
		display: 'flex',
		flex: '1',
		alignItems: 'center',
		justifyContent: 'flex-end'
	});

	const footerBtnClass = css({
		rounded: 'full',
		px: '0.5rem',
		py: '0.125rem',
		fontWeight: 'medium',
		lineHeight: '1.25rem',
		color: 'scrapscache.textMuted',
		cursor: 'pointer',
		transition: 'all 120ms ease',
		_hover: {
			bg: { base: 'black/5', _dark: 'white/10' },
			color: 'scrapscache.text'
		},
		_disabled: {
			pointerEvents: 'none',
			opacity: 0.4
		}
	});

	const statusTextClass = css({
		flexShrink: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		px: '0.5rem',
		lineHeight: '1.25rem',
		color: 'scrapscache.textMuted'
	});
</script>

<div class={`reminder-calendar ${containerClass}`}>
	<DatePicker.Root
		class={pickerRootClass}
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
					<span class={`reminder-dot ${dotClass}`}></span>
				{/if}
			{/snippet}
		</DatePickerViews>
	</DatePicker.Root>

	<div class={footerClass}>
		<div class={footerSideClass}>
			<button type="button" class={footerBtnClass} onclick={filterToday}> Today </button>
		</div>
		<span class={statusTextClass}>
			{#if pickingEnd}
				Pick an end day
			{:else if selected && selected.from !== selected.to}
				Range filter active
			{:else if selected}
				Day filter active
			{/if}
		</span>
		<div class={footerEndClass}>
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
