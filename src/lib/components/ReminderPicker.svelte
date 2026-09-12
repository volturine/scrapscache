<script lang="ts">
	import { createSubscriber, MediaQuery } from 'svelte/reactivity';
	import { CalendarDate } from '@internationalized/date';
	import { DatePicker, type DatePickerValueChangeDetails } from '@ark-ui/svelte/date-picker';
	import WheelPicker from './WheelPicker.svelte';
	import DatePickerViews from './DatePickerViews.svelte';
	import { AlarmClock, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { requestReminderPermission } from '$lib/reminderNotify';
	import { ensurePushSubscription } from '$lib/reminderWake';
	import { formatReminderCountdown } from '$lib/utils';
	import { PHONE_MEDIA } from '$lib/appViewport';
	import { css, cx, cva } from 'styled-system/css';
	import { badge, button, dialog, iconButton, status } from 'styled-system/recipes';
	import { hstack, flex } from 'styled-system/patterns';

	let {
		reminder,
		onClose,
		onApply,
		forceMode
	}: {
		reminder: number | null;
		onClose: () => void;
		onApply?: (value: number | null) => void;
		forceMode?: 'mobile' | 'desktop';
	} = $props();

	const MONTH_ITEMS = Array.from({ length: 12 }, (_, month) => ({
		value: month,
		label: new Date(2020, month, 1).toLocaleDateString([], { month: 'long' })
	}));
	const HOUR_ITEMS = Array.from({ length: 24 }, (_, hour) => ({
		value: hour,
		label: String(hour).padStart(2, '0')
	}));
	const MINUTE_ITEMS = Array.from({ length: 60 }, (_, minute) => ({
		value: minute,
		label: String(minute).padStart(2, '0')
	}));

	function daysInMonth(year: number, month: number): number {
		return new Date(year, month + 1, 0).getDate();
	}

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
	const phone = new MediaQuery(PHONE_MEDIA, false);
	const isMobile = $derived(forceMode ? forceMode === 'mobile' : phone.current);

	function apply(ts: number | null) {
		onApply?.(ts);
		onClose();
	}

	function shiftDay(delta: number) {
		const d = new Date(selected);
		d.setDate(d.getDate() + delta);
		selected = d;
	}

	function setDateParts(parts: { year?: number; month?: number; day?: number }) {
		const d = new Date(selected);
		const year = parts.year ?? d.getFullYear();
		const month = parts.month ?? d.getMonth();
		const day = parts.day ?? d.getDate();
		d.setFullYear(year, month, Math.min(day, daysInMonth(year, month)));
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
	const selectedMonth = $derived(selected.getMonth());
	const selectedDay = $derived(selected.getDate());
	const selectedYear = $derived(selected.getFullYear());

	const dayItems = $derived(
		Array.from({ length: daysInMonth(selectedYear, selectedMonth) }, (_, index) => ({
			value: index + 1,
			label: String(index + 1).padStart(2, '0')
		}))
	);

	const yearItems = $derived.by(() => {
		const nowYear = new Date().getFullYear();
		const start = Math.min(nowYear - 10, selectedYear);
		const end = Math.max(nowYear + 15, selectedYear);
		const items: { value: number; label: string }[] = [];
		for (let year = start; year <= end; year++) {
			items.push({ value: year, label: String(year) });
		}
		return items;
	});

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

	const d = dialog({ size: 'sm' });

	const badgeChip = cva({
		base: {
			minW: '4.25rem',
			flexShrink: 0,
			rounded: 'full',
			px: '0.5rem',
			py: '0.125rem',
			fontWeight: 'bold',
			textTransform: 'uppercase',
			letterSpacing: '0.05em'
		},
		variants: {
			status: {
				active: { bg: 'scrapscache.success', color: 'scrapscache.successForeground' },
				edit: { bg: 'scrapscache.warning', color: 'scrapscache.bg' },
				new: { bg: 'scrapscache.accent', color: 'scrapscache.accentForeground' }
			}
		}
	});

	const statusBoxClass = $derived(
		uiStatus === 'active'
			? status({ tone: 'success' })
			: uiStatus === 'unsaved'
				? status({ tone: 'warning' })
				: status({ tone: 'accent' })
	);
	const badgeLabel = $derived(
		uiStatus === 'active' ? 'Active' : uiStatus === 'unsaved' ? 'Edit' : 'New'
	);

	const dateBtn = cva({
		base: {
			mx: '0.25rem',
			display: 'flex',
			minW: 0,
			flex: '1',
			alignItems: 'center',
			justifyContent: 'center',
			rounded: 'lg',
			px: '0.5rem',
			py: '0.375rem',
			fontSize: 'sm',
			fontWeight: 'medium',
			color: 'scrapscache.text',
			cursor: 'pointer'
		},
		variants: {
			active: {
				true: { bg: 'scrapscache.bg' },
				false: {}
			}
		},
		defaultVariants: { active: false }
	});

	const calNavBtn = cx(
		iconButton({ variant: 'ghost', size: 'compact' }),
		css({ flexShrink: 0, color: 'inherit' })
	);

	const colonClass = css({
		display: 'flex',
		w: '0.75rem',
		flexShrink: 0,
		alignItems: 'center',
		justifyContent: 'center',
		fontSize: 'xl',
		fontWeight: '600',
		color: 'scrapscache.text'
	});

	const ellipsisClass = css({
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap'
	});

	const wheelDeckRaw = {
		rounded: 'xl',
		bg: 'scrapscache.surfaceSubtle',
		px: '0.5rem',
		py: '0.25rem'
	};

	const sectionLabelClass = css({
		fontWeight: 'medium',
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		color: 'scrapscache.textMuted'
	});

	const hintClass = css({
		mt: '0.25rem',
		fontSize: '11px',
		lineHeight: 'snug',
		color: 'scrapscache.textMuted'
	});

	const statusLabelClass = css({
		minW: 0,
		fontSize: '10px',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		color: 'scrapscache.textMuted'
	});

	const remainingClass = css({
		minW: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap'
	});

	const dividerClass = css({
		mb: '1rem',
		borderTopWidth: '1px',
		borderColor: 'scrapscache.border',
		pt: '1rem'
	});

	const footerDividerClass = {
		gap: '0.5rem',
		borderTopWidth: '1px',
		borderColor: 'scrapscache.border',
		pt: '1rem'
	};
</script>

<div class={cx(d.panel, css({ w: '20rem', p: '1.25rem', gap: 0 }))}>
	<div
		class={cx(
			d.title,
			css({ mb: '0.75rem', fontSize: 'base', fontWeight: 'medium', lineHeight: 'normal' })
		)}
	>
		Reminder
	</div>

	<div
		class={cx(statusBoxClass, css({ mb: '1rem', rounded: 'lg', px: '0.75rem', py: '0.625rem' }))}
	>
		<div class={hstack({ justify: 'space-between', gap: '0.5rem' })}>
			<div class={statusLabelClass}>Will remind you</div>
			<span
				class={cx(
					badge({ variant: 'subtle', size: 'sm' }),
					badgeChip({ status: uiStatus === 'unsaved' ? 'edit' : uiStatus })
				)}>{badgeLabel}</span
			>
		</div>
		<div
			class={hstack({
				gap: '0.5rem',
				mt: '0.375rem',
				fontSize: 'sm',
				fontWeight: '600',
				color: 'scrapscache.text'
			})}
		>
			<AlarmClock class={css({ w: '1rem', h: '1rem', flexShrink: 0 })} aria-hidden="true" />
			<span class={remainingClass}>{remainingLabel}</span>
		</div>
		<div class={hintClass}>Closed-app alerts need Sync on this device.</div>
	</div>

	<div class={dividerClass}>
		<div class={cx(sectionLabelClass, css({ mb: '0.75rem', fontSize: 'xs' }))}>
			Pick date & time
		</div>

		<div class="schedule-panel">
			{#if isMobile}
				<div class={hstack({ mb: '0.75rem' })}>
					<button
						type="button"
						class={calNavBtn}
						onclick={() => shiftDay(-1)}
						aria-label="Previous day"
					>
						<ChevronLeft size={20} aria-hidden="true" />
					</button>
					<button
						type="button"
						class={dateBtn({ active: monthYearOpen })}
						onclick={() => (monthYearOpen = !monthYearOpen)}
						aria-label="Choose date"
						aria-expanded={monthYearOpen}
					>
						<span class={ellipsisClass}>{dateLabel}</span>
					</button>
					<button type="button" class={calNavBtn} onclick={() => shiftDay(1)} aria-label="Next day">
						<ChevronRight size={20} aria-hidden="true" />
					</button>
				</div>

				{#if monthYearOpen}
					<div class={hstack({ justify: 'center', gap: '0.5rem', ...wheelDeckRaw })}>
						<WheelPicker
							class={css({ w: '3rem' })}
							items={dayItems}
							value={selectedDay}
							onChange={(day) => setDateParts({ day })}
							ariaLabel="Day"
						/>
						<WheelPicker
							class={css({ w: '7.75rem' })}
							items={MONTH_ITEMS}
							value={selectedMonth}
							onChange={(month) => setDateParts({ month })}
							ariaLabel="Month"
						/>
						<WheelPicker
							class={css({ w: '4.5rem' })}
							items={yearItems}
							value={selectedYear}
							onChange={(year) => setDateParts({ year })}
							ariaLabel="Year"
						/>
					</div>
				{:else}
					<div class={hstack({ justify: 'center', gap: '0.25rem', ...wheelDeckRaw })}>
						<WheelPicker
							class={css({ w: '4rem' })}
							items={HOUR_ITEMS}
							value={hours24}
							onChange={setHour}
							ariaLabel="Hour"
						/>
						<div class={colonClass} aria-hidden="true">:</div>
						<WheelPicker
							class={css({ w: '4rem' })}
							items={MINUTE_ITEMS}
							value={minutes}
							onChange={setMinute}
							ariaLabel="Minute"
						/>
					</div>
				{/if}
			{:else if monthYearOpen}
				<div class={css({ h: 'full', overflow: 'hidden', ...wheelDeckRaw, py: '0.5rem' })}>
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
				<div class={flex({ h: 'full', direction: 'column' })}>
					<div class={hstack({ mb: '0.75rem' })}>
						<button
							type="button"
							class={calNavBtn}
							onclick={() => shiftDay(-1)}
							aria-label="Previous day"
						>
							<ChevronLeft size={20} aria-hidden="true" />
						</button>
						<button
							type="button"
							class={dateBtn()}
							onclick={() => (monthYearOpen = true)}
							aria-label="Choose date"
							aria-expanded="false"
						>
							<span class={ellipsisClass}>{dateLabel}</span>
						</button>
						<button
							type="button"
							class={calNavBtn}
							onclick={() => shiftDay(1)}
							aria-label="Next day"
						>
							<ChevronRight size={20} aria-hidden="true" />
						</button>
					</div>
					<div
						class={flex({
							minH: 0,
							flex: '1',
							align: 'center',
							justify: 'center',
							gap: '0.25rem',
							...wheelDeckRaw
						})}
					>
						<WheelPicker
							class={css({ w: '4rem' })}
							items={HOUR_ITEMS}
							value={hours24}
							onChange={setHour}
							ariaLabel="Hour"
						/>
						<div class={colonClass} aria-hidden="true">:</div>
						<WheelPicker
							class={css({ w: '4rem' })}
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

	<div class={hstack(footerDividerClass)}>
		{#if showRemove}
			<button
				type="button"
				onclick={clear}
				class={cx(button({ variant: 'quiet', size: 'md' }), css({ flexShrink: 0 }))}
			>
				Remove
			</button>
		{/if}
		<button
			type="button"
			onclick={onClose}
			class={cx(button({ variant: 'secondary', size: 'md' }), css({ minW: '5.5rem' }))}
		>
			Cancel
		</button>
		{#if primaryIsSave}
			<button
				type="button"
				onclick={save}
				class={cx(button({ variant: 'primary', size: 'md' }), css({ minW: '5.5rem', ml: 'auto' }))}
			>
				Save
			</button>
		{/if}
	</div>
</div>
