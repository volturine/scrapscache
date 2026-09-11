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
	import { css } from 'styled-system/css';
	import { button } from 'styled-system/recipes';

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

	const dialogBoxClass = css({
		w: '20rem',
		p: '1.25rem'
	});

	const headingClass = css({
		mb: '0.75rem',
		fontSize: 'base',
		fontWeight: 'medium',
		color: 'scrapscache.text'
	});

	const statusBoxBase = css({
		mb: '1rem',
		rounded: 'lg',
		px: '0.75rem',
		py: '0.625rem'
	});

	const statusHeaderClass = css({
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '0.5rem'
	});

	const statusLabelClass = css({
		minW: 0,
		fontSize: '10px',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		color: 'scrapscache.textMuted'
	});

	const badgeActive = css({
		display: 'inline-flex',
		minW: '4.25rem',
		flexShrink: 0,
		justifyContent: 'center',
		rounded: 'full',
		bg: 'scrapscache.success',
		px: '0.5rem',
		py: '0.125rem',
		fontSize: '10px',
		fontWeight: 'bold',
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		color: 'scrapscache.successForeground'
	});

	const badgeEdit = css({
		display: 'inline-flex',
		minW: '4.25rem',
		flexShrink: 0,
		justifyContent: 'center',
		rounded: 'full',
		bg: 'scrapscache.warning',
		px: '0.5rem',
		py: '0.125rem',
		fontSize: '10px',
		fontWeight: 'bold',
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		color: 'scrapscache.bg'
	});

	const badgeNew = css({
		display: 'inline-flex',
		minW: '4.25rem',
		flexShrink: 0,
		justifyContent: 'center',
		rounded: 'full',
		bg: 'scrapscache.accent',
		px: '0.5rem',
		py: '0.125rem',
		fontSize: '10px',
		fontWeight: 'bold',
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		color: 'scrapscache.accentForeground'
	});

	const countdownRowClass = css({
		mt: '0.375rem',
		display: 'flex',
		alignItems: 'center',
		gap: '0.5rem',
		fontSize: 'sm',
		fontWeight: '600',
		color: 'scrapscache.text'
	});

	const clockIconClass = css({
		w: '1rem',
		h: '1rem',
		flexShrink: 0
	});

	const countdownTextClass = css({
		minW: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap'
	});

	const statusHintClass = css({
		mt: '0.25rem',
		fontSize: '11px',
		lineHeight: 'snug',
		color: 'scrapscache.textMuted'
	});

	const sectionDividerClass = css({
		mb: '1rem',
		borderTopWidth: '1px',
		borderColor: 'scrapscache.border',
		pt: '1rem'
	});

	const sectionTitleClass = css({
		mb: '0.75rem',
		fontSize: 'xs',
		fontWeight: 'medium',
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		color: 'scrapscache.textMuted'
	});

	const navRowClass = css({
		mb: '0.75rem',
		display: 'flex',
		alignItems: 'center'
	});

	const dateBtnClass = css({
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
	});

	const dateBtnActiveClass = css({
		bg: 'scrapscache.bg'
	});

	const wheelGroupClass = css({
		display: 'flex',
		justifyContent: 'center',
		gap: '0.5rem',
		rounded: 'xl',
		bg: { base: 'black/3', _dark: 'white/4' },
		px: '0.5rem',
		py: '0.25rem'
	});

	const wheelColDay = css({ w: '3rem' });
	const wheelColMonth = css({ w: '7.75rem' });
	const wheelColYear = css({ w: '4.5rem' });
	const wheelColTime = css({ w: '4rem' });
	const calNavBtn = css({ h: '2rem', w: '2rem', flexShrink: 0, p: '0.5rem' });
	const wheelTimeGroupClass = css({
		display: 'flex',
		justifyContent: 'center',
		gap: '0.25rem',
		rounded: 'xl',
		bg: { base: 'black/3', _dark: 'white/4' },
		px: '0.5rem',
		py: '0.25rem'
	});

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

	const footerRowClass = css({
		display: 'flex',
		alignItems: 'center',
		gap: '0.5rem',
		borderTopWidth: '1px',
		borderColor: 'scrapscache.border',
		pt: '1rem'
	});

	const btnMinW = css({
		minW: '5.5rem'
	});
</script>

<div class={`scrapscache-dialog ${dialogBoxClass}`}>
	<div class={headingClass}>Reminder</div>

	<div
		class={`${statusBoxBase} ${
			uiStatus === 'active'
				? 'scrapscache-status-success'
				: uiStatus === 'unsaved'
					? 'scrapscache-status-warning'
					: 'scrapscache-status-accent'
		}`}
	>
		<div class={statusHeaderClass}>
			<div class={statusLabelClass}>Will remind you</div>
			{#if uiStatus === 'active'}
				<span class={badgeActive}>Active</span>
			{:else if uiStatus === 'unsaved'}
				<span class={badgeEdit}>Edit</span>
			{:else}
				<span class={badgeNew}>New</span>
			{/if}
		</div>
		<div class={countdownRowClass}>
			<AlarmClock class={clockIconClass} aria-hidden="true" />
			<span class={countdownTextClass}>{remainingLabel}</span>
		</div>
		<div class={statusHintClass}>Closed-app alerts need Sync on this device.</div>
	</div>

	<div class={sectionDividerClass}>
		<div class={sectionTitleClass}>Pick date & time</div>

		<div class="schedule-panel">
			{#if isMobile}
				<div class={navRowClass}>
					<button
						type="button"
						class={`icon-btn ${calNavBtn}`}
						onclick={() => shiftDay(-1)}
						aria-label="Previous day"
					>
						<ChevronLeft size={20} aria-hidden="true" />
					</button>
					<button
						type="button"
						class={`${dateBtnClass} ${monthYearOpen ? dateBtnActiveClass : ''}`}
						onclick={() => (monthYearOpen = !monthYearOpen)}
						aria-label="Choose date"
						aria-expanded={monthYearOpen}
					>
						<span
							class={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}
							>{dateLabel}</span
						>
					</button>
					<button
						type="button"
						class={`icon-btn ${calNavBtn}`}
						onclick={() => shiftDay(1)}
						aria-label="Next day"
					>
						<ChevronRight size={20} aria-hidden="true" />
					</button>
				</div>

				{#if monthYearOpen}
					<div class={wheelGroupClass}>
						<WheelPicker
							class={wheelColDay}
							items={dayItems}
							value={selectedDay}
							onChange={(day) => setDateParts({ day })}
							ariaLabel="Day"
						/>
						<WheelPicker
							class={wheelColMonth}
							items={MONTH_ITEMS}
							value={selectedMonth}
							onChange={(month) => setDateParts({ month })}
							ariaLabel="Month"
						/>
						<WheelPicker
							class={wheelColYear}
							items={yearItems}
							value={selectedYear}
							onChange={(year) => setDateParts({ year })}
							ariaLabel="Year"
						/>
					</div>
				{:else}
					<div class={wheelTimeGroupClass}>
						<WheelPicker
							class={wheelColTime}
							items={HOUR_ITEMS}
							value={hours24}
							onChange={setHour}
							ariaLabel="Hour"
						/>
						<div class={colonClass} aria-hidden="true">:</div>
						<WheelPicker
							class={wheelColTime}
							items={MINUTE_ITEMS}
							value={minutes}
							onChange={setMinute}
							ariaLabel="Minute"
						/>
					</div>
				{/if}
			{:else if monthYearOpen}
				<div
					class={css({
						h: 'full',
						overflow: 'hidden',
						rounded: 'xl',
						bg: { base: 'black/3', _dark: 'white/4' },
						px: '0.5rem',
						py: '0.5rem'
					})}
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
				<div class={css({ display: 'flex', h: 'full', flexDirection: 'column' })}>
					<div class={navRowClass}>
						<button
							type="button"
							class={`icon-btn ${calNavBtn}`}
							onclick={() => shiftDay(-1)}
							aria-label="Previous day"
						>
							<ChevronLeft size={20} aria-hidden="true" />
						</button>
						<button
							type="button"
							class={dateBtnClass}
							onclick={() => (monthYearOpen = true)}
							aria-label="Choose date"
							aria-expanded="false"
						>
							<span
								class={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}
								>{dateLabel}</span
							>
						</button>
						<button
							type="button"
							class={`icon-btn ${calNavBtn}`}
							onclick={() => shiftDay(1)}
							aria-label="Next day"
						>
							<ChevronRight size={20} aria-hidden="true" />
						</button>
					</div>
					<div
						class={css({
							display: 'flex',
							minH: 0,
							flex: '1',
							alignItems: 'center',
							justifyContent: 'center',
							gap: '0.25rem',
							rounded: 'xl',
							bg: { base: 'black/3', _dark: 'white/4' },
							px: '0.5rem',
							py: '0.25rem'
						})}
					>
						<WheelPicker
							class={wheelColTime}
							items={HOUR_ITEMS}
							value={hours24}
							onChange={setHour}
							ariaLabel="Hour"
						/>
						<div class={colonClass} aria-hidden="true">:</div>
						<WheelPicker
							class={wheelColTime}
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

	<div class={footerRowClass}>
		{#if showRemove}
			<button
				type="button"
				onclick={clear}
				class={`${button({ variant: 'quiet', size: 'md' })} ${css({ flexShrink: 0 })}`}
			>
				Remove
			</button>
		{/if}
		<button
			type="button"
			onclick={onClose}
			class={`${button({ variant: 'secondary', size: 'md' })} ${btnMinW}`}
		>
			Cancel
		</button>
		{#if primaryIsSave}
			<button
				type="button"
				onclick={save}
				class={`${button({ variant: 'primary', size: 'md' })} ${btnMinW} ${css({ ml: 'auto' })}`}
			>
				Save
			</button>
		{/if}
	</div>
</div>
