<script lang="ts">
	import { reminderPickerStyles as styles } from '$panda/styles';
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
	import { css, cx } from 'styled-system/css';
	import { badge, button, dialog, iconButton } from 'styled-system/recipes';
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

	const statusBoxClass = $derived(
		css({
			borderWidth: 'hairline',
			borderColor: 'currentColor',
			...(uiStatus === 'active'
				? { bg: 'scrapscache.successSubtle', color: 'scrapscache.success' }
				: uiStatus === 'unsaved'
					? { bg: 'scrapscache.warningSubtle', color: 'scrapscache.warning' }
					: { bg: 'scrapscache.accentSubtle', color: 'scrapscache.accent' })
		})
	);
	const badgeLabel = $derived(
		uiStatus === 'active' ? 'Active' : uiStatus === 'unsaved' ? 'Edit' : 'New'
	);

	const calNavBtn = cx(
		iconButton({ variant: 'ghost', size: 'compact' }),
		css({ flexShrink: 0, color: 'inherit' })
	);
</script>

<div class={cx(d.panel, css({ w: '20rem', p: 'xl', gap: 0 }))}>
	<div class={cx(d.title, css({ mb: 'md', textStyle: 'subtitle' }))}>Reminder</div>

	<div class={cx(statusBoxClass, css({ mb: 'lg', rounded: 'card', px: 'md', py: 'list' }))}>
		<div class={hstack({ justify: 'space-between', gap: 'sm' })}>
			<div
				class={css({
					minW: 0,
					textStyle: 'micro',
					textTransform: 'uppercase',
					letterSpacing: 'status',
					color: 'scrapscache.textMuted'
				})}
			>
				Will remind you
			</div>
			<span
				class={cx(
					badge({ variant: 'subtle', size: 'sm' }),
					css({
						minW: '4.25rem',
						flexShrink: 0,
						rounded: 'pill',
						px: 'sm',
						py: '3xs',
						fontWeight: 'strong',
						textTransform: 'uppercase',
						letterSpacing: 'status'
					}),
					uiStatus === 'active'
						? css({ bg: 'scrapscache.success', color: 'scrapscache.successForeground' })
						: uiStatus === 'unsaved'
							? css({ bg: 'scrapscache.warning', color: 'scrapscache.bg' })
							: css({ bg: 'scrapscache.accent', color: 'scrapscache.accentForeground' })
				)}>{badgeLabel}</span
			>
		</div>
		<div
			class={hstack({
				gap: 'sm',
				mt: 'xs',
				textStyle: 'bodyStrong',
				color: 'scrapscache.text'
			})}
		>
			<AlarmClock class={css({ w: '1rem', h: '1rem', flexShrink: 0 })} aria-hidden="true" />
			<span class={styles.ellipsis}>{remainingLabel}</span>
		</div>
		<div class={css({ mt: '2xs', textStyle: 'caption' })}>
			Closed-app alerts need Sync on this device.
		</div>
	</div>

	<div
		class={css({
			mb: 'lg',
			borderTopWidth: 'hairline',
			borderColor: 'scrapscache.border',
			pt: 'lg'
		})}
	>
		<div
			class={css({
				mb: 'md',
				fontSize: 'label',
				fontWeight: 'interactive',
				textTransform: 'uppercase',
				letterSpacing: 'status',
				color: 'scrapscache.textMuted'
			})}
		>
			Pick date & time
		</div>

		<div data-schedule-panel>
			{#if isMobile}
				<div class={hstack({ mb: 'md' })}>
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
						class={cx(
							button({ variant: 'ghost', size: 'sm' }),
							css({
								mx: '2xs',
								minW: 0,
								flex: '1',
								rounded: 'card',
								px: 'sm',
								py: 'xs',
								textStyle: 'button',
								color: 'scrapscache.text'
							}),
							monthYearOpen ? css({ bg: 'scrapscache.bg' }) : undefined
						)}
						onclick={() => (monthYearOpen = !monthYearOpen)}
						aria-label="Choose date"
						aria-expanded={monthYearOpen}
					>
						<span class={styles.ellipsis}>{dateLabel}</span>
					</button>
					<button type="button" class={calNavBtn} onclick={() => shiftDay(1)} aria-label="Next day">
						<ChevronRight size={20} aria-hidden="true" />
					</button>
				</div>

				{#if monthYearOpen}
					<div class={cx(hstack({ justify: 'center', gap: 'sm' }), styles.wheelDeck)}>
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
					<div class={cx(hstack({ justify: 'center', gap: '2xs' }), styles.wheelDeck)}>
						<WheelPicker
							class={styles.timeWheel}
							items={HOUR_ITEMS}
							value={hours24}
							onChange={setHour}
							ariaLabel="Hour"
						/>
						<div class={styles.colon} aria-hidden="true">:</div>
						<WheelPicker
							class={styles.timeWheel}
							items={MINUTE_ITEMS}
							value={minutes}
							onChange={setMinute}
							ariaLabel="Minute"
						/>
					</div>
				{/if}
			{:else if monthYearOpen}
				<div class={cx(styles.wheelDeck, css({ h: 'full', overflow: 'hidden', py: 'sm' }))}>
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
					<div class={hstack({ mb: 'md' })}>
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
							class={cx(
								button({ variant: 'ghost', size: 'sm' }),
								css({
									mx: '2xs',
									minW: 0,
									flex: '1',
									rounded: 'card',
									px: 'sm',
									py: 'xs',
									textStyle: 'button',
									color: 'scrapscache.text'
								})
							)}
							onclick={() => (monthYearOpen = true)}
							aria-label="Choose date"
							aria-expanded="false"
						>
							<span class={styles.ellipsis}>{dateLabel}</span>
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
						class={cx(
							flex({
								minH: 0,
								flex: '1',
								align: 'center',
								justify: 'center',
								gap: '2xs'
							}),
							styles.wheelDeck
						)}
					>
						<WheelPicker
							class={styles.timeWheel}
							items={HOUR_ITEMS}
							value={hours24}
							onChange={setHour}
							ariaLabel="Hour"
						/>
						<div class={styles.colon} aria-hidden="true">:</div>
						<WheelPicker
							class={styles.timeWheel}
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

	<div
		class={cx(
			hstack(),
			css({ gap: 'sm', borderTopWidth: 'hairline', borderColor: 'scrapscache.border', pt: 'lg' })
		)}
	>
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
