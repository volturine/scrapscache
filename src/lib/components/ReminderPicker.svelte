<script lang="ts">
	import { createSubscriber } from 'svelte/reactivity';
	import { CalendarDate } from '@internationalized/date';
	import { DatePicker, type DatePickerValueChangeDetails } from '@ark-ui/svelte/date-picker';
	import WheelPicker from './WheelPicker.svelte';
	import DatePickerViews from './DatePickerViews.svelte';
	import { AlarmClock, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { requestReminderPermission } from '$lib/reminderNotify';
	import { ensurePushSubscription } from '$lib/reminderWake';
	import { formatReminderCountdown } from '$lib/utils';

	let {
		reminder,
		onClose,
		onApply
	}: {
		reminder: number | null;
		onClose: () => void;
		onApply?: (value: number | null) => void;
	} = $props();

	const HOUR_ITEMS = Array.from({ length: 24 }, (_, hour) => ({
		value: hour,
		label: String(hour).padStart(2, '0')
	}));
	const MINUTE_ITEMS = Array.from({ length: 60 }, (_, minute) => ({
		value: minute,
		label: String(minute).padStart(2, '0')
	}));

	// Initialize once from the existing reminder or now+1h default
	function initDate(ts: number | null): Date {
		if (ts == null || !Number.isFinite(ts)) {
			const d = new Date();
			d.setHours(d.getHours() + 1, 0, 0, 0);
			return d;
		}
		return new Date(ts);
	}

	// Plain state so sync-driven prop changes cannot discard unsaved picker edits.
	// svelte-ignore state_referenced_locally -- snapshot the reminder at open time on purpose
	let selected = $state(initDate(reminder));
	let monthYearOpen = $state(false);

	function apply(ts: number | null) {
		onApply?.(ts);
		onClose();
	}

	function shiftDay(delta: number) {
		const d = new Date(selected);
		d.setDate(d.getDate() + delta);
		selected = d;
	}

	const dateLabel = $derived(
		selected.toLocaleDateString([], {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		})
	);

	const subscribeNow = createSubscriber((update) => {
		const id = setInterval(update, 1000);
		return () => clearInterval(id);
	});
	const draftMs = $derived(selected.getTime());
	const remainingLabel = $derived.by(() => {
		subscribeNow();
		return formatReminderCountdown(draftMs);
	});

	/** off = no reminder on note; active = saved & unchanged; unsaved = edits or new before Save */
	const uiStatus = $derived.by(() => {
		if (reminder == null) return 'new' as const;
		if (draftMs === reminder) return 'active' as const;
		return 'unsaved' as const;
	});

	const showRemove = $derived(reminder != null);
	const primaryIsSave = $derived(uiStatus !== 'active');

	const hours24 = $derived(selected.getHours());
	const minutes = $derived(selected.getMinutes());
	const pickerValue = $derived([
		new CalendarDate(selected.getFullYear(), selected.getMonth() + 1, selected.getDate())
	]);

	function onDateChange(details: DatePickerValueChangeDetails) {
		const next = details.value[0];
		if (!next) return;
		const d = new Date(selected);
		d.setFullYear(next.year, next.month - 1, next.day);
		selected = d;
		monthYearOpen = false;
	}

	function closeCalendarIfDayPicked(event: MouseEvent) {
		if (
			event.target instanceof Element &&
			event.target.closest('[data-part="view"][data-view="day"] [data-part="cell-trigger"]')
		) {
			monthYearOpen = false;
		}
	}

	function setHour(hour: number) {
		const d = new Date(selected);
		d.setHours(hour);
		selected = d;
	}

	function setMinute(minute: number) {
		const d = new Date(selected);
		d.setMinutes(minute);
		selected = d;
	}

	async function save() {
		await requestReminderPermission();
		await ensurePushSubscription();
		apply(selected.getTime());
	}
	function clear() {
		apply(null);
	}
</script>

<div class="scrapscache-dialog w-80 p-5">
	<div class="mb-3 text-base font-medium text-[var(--scrapscache-text)]">Reminder</div>

	<div
		class="mb-4 rounded-[var(--scrapscache-radius-lg)] px-3 py-2.5 {uiStatus === 'active'
			? 'scrapscache-status-success'
			: uiStatus === 'unsaved'
				? 'scrapscache-status-warning'
				: 'scrapscache-status-accent'}"
	>
		<div class="flex items-center justify-between gap-2">
			<div
				class="min-w-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--scrapscache-text-muted)]"
			>
				Will remind you
			</div>
			{#if uiStatus === 'active'}
				<span
					class="inline-flex min-w-[4.25rem] shrink-0 justify-center rounded-full bg-[var(--scrapscache-success)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--scrapscache-success-foreground)]"
					>Active</span
				>
			{:else if uiStatus === 'unsaved'}
				<span
					class="inline-flex min-w-[4.25rem] shrink-0 justify-center rounded-full bg-[var(--scrapscache-warning)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--scrapscache-bg)]"
					>Edit</span
				>
			{:else}
				<span
					class="inline-flex min-w-[4.25rem] shrink-0 justify-center rounded-full bg-[var(--scrapscache-accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--scrapscache-accent-foreground)]"
					>New</span
				>
			{/if}
		</div>
		<div
			class="mt-1.5 flex items-center gap-2 text-sm font-semibold text-[var(--scrapscache-text)]"
		>
			<AlarmClock class="h-4 w-4 shrink-0" aria-hidden="true" />
			<span class="min-w-0 truncate">{remainingLabel}</span>
		</div>
		<div class="mt-1 text-[11px] leading-snug text-[var(--scrapscache-text-muted)]">
			Closed-app alerts need Sync on this device.
		</div>
	</div>

	<div class="mb-4 border-t border-[var(--scrapscache-border)] pt-4">
		<div
			class="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--scrapscache-text-muted)]"
		>
			Pick date & time
		</div>

		<div class="schedule-panel">
			{#if monthYearOpen}
				<div
					class="h-full overflow-hidden rounded-xl bg-black/[0.03] px-2 py-2 dark:bg-white/[0.04]"
					role="presentation"
					onclick={closeCalendarIfDayPicked}
				>
					<DatePicker.Root
						inline
						startOfWeek={1}
						fixedWeeks
						value={pickerValue}
						onValueChange={onDateChange}
					>
						<DatePickerViews />
					</DatePicker.Root>
				</div>
			{:else}
				<div class="flex h-full flex-col">
					<div class="mb-3 flex items-center">
						<button
							type="button"
							class="icon-btn h-8 w-8 shrink-0 p-2"
							onclick={() => shiftDay(-1)}
							aria-label="Previous day"
						>
							<ChevronLeft class="h-5 w-5" aria-hidden="true" />
						</button>
						<button
							type="button"
							class="mx-1 flex min-w-0 flex-1 items-center justify-center rounded-lg px-2 py-1.5 text-sm font-medium text-[var(--scrapscache-text)]"
							onclick={() => (monthYearOpen = true)}
							aria-label="Choose date"
							aria-expanded="false"
						>
							<span class="truncate">{dateLabel}</span>
						</button>
						<button
							type="button"
							class="icon-btn h-8 w-8 shrink-0 p-2"
							onclick={() => shiftDay(1)}
							aria-label="Next day"
						>
							<ChevronRight class="h-5 w-5" aria-hidden="true" />
						</button>
					</div>
					<div
						class="flex min-h-0 flex-1 items-center justify-center gap-1 rounded-xl bg-black/[0.03] px-2 py-1 dark:bg-white/[0.04]"
					>
						<WheelPicker
							class="w-16"
							items={HOUR_ITEMS}
							value={hours24}
							onChange={setHour}
							ariaLabel="Hour"
						/>
						<div
							class="flex w-3 shrink-0 items-center justify-center text-xl font-semibold text-[var(--scrapscache-text)]"
							aria-hidden="true"
						>
							:
						</div>
						<WheelPicker
							class="w-16"
							items={MINUTE_ITEMS}
							value={minutes}
							onChange={setMinute}
							ariaLabel="Minute"
						/>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<div class="flex items-center gap-2 border-t border-[var(--scrapscache-border)] pt-4">
		{#if showRemove}
			<button
				type="button"
				onclick={clear}
				class="scrapscache-button scrapscache-button-quiet shrink-0 px-3 py-2.5 text-sm font-medium"
			>
				Remove
			</button>
		{/if}
		<button
			type="button"
			onclick={onClose}
			class="scrapscache-button scrapscache-button-secondary min-w-[5.5rem] px-4 py-2.5 text-sm font-medium"
		>
			Cancel
		</button>
		{#if primaryIsSave}
			<button
				type="button"
				onclick={save}
				class="scrapscache-button scrapscache-button-primary ml-auto min-w-[5.5rem] px-4 py-2.5 text-sm font-medium"
			>
				Save
			</button>
		{/if}
	</div>
</div>

<style>
	.schedule-panel {
		height: 17.25rem;
	}
</style>
