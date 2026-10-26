<script lang="ts">
	import { reminderPickerStyles as styles } from '$panda/styles';
	import { createSubscriber, MediaQuery } from 'svelte/reactivity';
	import { CalendarDate } from '@internationalized/date';
	import { DatePicker, type DatePickerValueChangeDetails } from '@ark-ui/svelte/date-picker';
	import { Menu } from '@ark-ui/svelte/menu';
	import WheelPicker from './WheelPicker.svelte';
	import DatePickerViews from './DatePickerViews.svelte';
	import {
		AlarmClock,
		Check,
		ChevronDown,
		ChevronLeft,
		ChevronRight,
		Repeat,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import {
		describeRepeat,
		firstRepeatTime,
		localTimeZone,
		reminderShownAt,
		repeatChoiceId,
		repeatChoices,
		sameRepeatPattern,
		MAX_REPEAT_EVERY,
		type ReminderRepeat,
		type RepeatUnit
	} from '#lib/model/index.js';
	import {
		notificationPermission,
		notificationsBlockedHint,
		requestReminderPermission
	} from '#lib/reminderNotify.js';
	import { registerAllReminderDevices, reminderPushSupported } from '#lib/reminderWake.js';
	import { useEditorActions } from '#lib/editorContext.js';
	import { pwaInstallStore } from '#lib/stores/pwaInstall.svelte.js';
	import { syncStore } from '#lib/stores/sync.svelte.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { formatReminderCountdown } from '#lib/utils.js';
	import { PHONE_MEDIA } from '#lib/appViewport.js';
	import {
		REMINDER_LANGUAGES,
		loadPhraseReaders,
		readReminderPhrase,
		type PhraseReader,
		type ReminderPhrase
	} from '#lib/reminderPhrase.js';
	import { css, cx } from 'styled-system/css';
	import { badge, button, dialog, iconButton, input, menuItem } from 'styled-system/recipes';
	import { popover } from '$panda/styles';
	import { hstack, flex } from 'styled-system/patterns';

	let {
		reminder,
		repeat = null,
		onClose,
		onApply,
		forceMode
	}: {
		/** The reminder's first time. */
		reminder: number | null;
		repeat?: ReminderRepeat | null;
		onClose: () => void;
		/** The first time and how it repeats, or null to remove the reminder. */
		onApply?: (value: number | null, repeat: ReminderRepeat | null) => void;
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

	/** What the picker opens on: a repeating reminder's next time, not its first. */
	// svelte-ignore state_referenced_locally -- snapshot the reminder at open time on purpose
	const opened = reminderShownAt({ reminder, repeat }, Date.now());
	// Plain state so sync-driven prop changes cannot discard unsaved picker edits.
	let selected = $state(initDate(opened));
	type RepeatPattern = Pick<ReminderRepeat, 'unit' | 'every' | 'weekdays'>;
	/** How the draft repeats; its zone is set on save, from where it is picked. */
	// svelte-ignore state_referenced_locally -- snapshot the repeat at open time on purpose
	let repeatDraft = $state<RepeatPattern | null>(repeat && patternOf(repeat));
	let monthYearOpen = $state(false);
	const phone = new MediaQuery(PHONE_MEDIA, false);
	const isMobile = $derived(forceMode ? forceMode === 'mobile' : phone.current);

	/** The pattern alone: no zone, and none of the times skipped or moved by hand. */
	function patternOf({ unit, every, weekdays }: ReminderRepeat): RepeatPattern {
		return weekdays ? { unit, every, weekdays } : { unit, every };
	}

	function apply(ts: number | null, next: ReminderRepeat | null = null) {
		onApply?.(ts, next);
		onClose();
	}

	/** A date or time picked with the controls below the field: it replaces any typed one. */
	function pick(d: Date) {
		selected = d;
		phrase = '';
		reading = null;
		beforeTyping = null;
		repeatBeforeTyping = undefined;
	}

	function shiftDay(delta: number) {
		const d = new Date(selected);
		d.setDate(d.getDate() + delta);
		pick(d);
	}

	function setDateParts(parts: { year?: number; month?: number; day?: number }) {
		const d = new Date(selected);
		const year = parts.year ?? d.getFullYear();
		const month = parts.month ?? d.getMonth();
		const day = parts.day ?? d.getDate();
		d.setFullYear(year, month, Math.min(day, daysInMonth(year, month)));
		pick(d);
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
	/** An unchanged repeat keeps the zone it was set in; a new or changed one takes this device's. */
	const repeatUnchanged = $derived(
		!!repeat && !!repeatDraft && sameRepeatPattern({ ...repeatDraft, zone: repeat.zone }, repeat)
	);
	const draftRepeat = $derived<ReminderRepeat | null>(
		repeatDraft && { ...repeatDraft, zone: repeatUnchanged ? repeat!.zone : localTimeZone() }
	);
	/** When the draft first comes: a repeat picked for a time gone comes at its next time. */
	const draftFirst = $derived.by(() => {
		if (!draftRepeat) return draftMs;
		subscribeNow();
		return firstRepeatTime(draftMs, draftRepeat, Date.now());
	});
	const remainingLabel = $derived.by(() => {
		subscribeNow();
		const left = formatReminderCountdown(draftFirst);
		return draftRepeat ? `${left}, then ${describeRepeat(draftFirst, draftRepeat)}` : left;
	});

	/** off = no reminder on note; active = saved & unchanged; unsaved = edits or new before Save */
	const uiStatus = $derived.by(() => {
		if (reminder == null) return 'new' as const;
		if (draftMs === opened && (repeat ? repeatUnchanged : !repeatDraft)) return 'active' as const;
		return 'unsaved' as const;
	});

	// Repeat. A ready-made choice is named for the picked day; anything else is custom.
	const choices = $derived(repeatChoices(draftMs, localTimeZone()));
	let customOpen = $state(false);
	const choiceId = $derived(customOpen ? 'custom' : repeatChoiceId(draftMs, draftRepeat));
	const repeatLabel = $derived.by(() => {
		if (!draftRepeat) return 'Does not repeat';
		const words = describeRepeat(draftFirst, draftRepeat);
		return words[0].toUpperCase() + words.slice(1);
	});
	const UNITS: { value: RepeatUnit; one: string; many: string }[] = [
		{ value: 'day', one: 'Day', many: 'Days' },
		{ value: 'week', one: 'Week', many: 'Weeks' },
		{ value: 'month', one: 'Month', many: 'Months' },
		{ value: 'year', one: 'Year', many: 'Years' }
	];
	/** Monday first, as the calendar has it. */
	const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map((day) => ({
		value: day,
		short: new Date(2026, 0, 4 + day).toLocaleDateString('en-US', { weekday: 'narrow' }),
		name: new Date(2026, 0, 4 + day).toLocaleDateString('en-US', { weekday: 'long' })
	}));

	function chooseRepeat(id: string) {
		if (id === 'custom') {
			// Custom starts from what is picked: a weekly repeat names its day.
			const base = repeatDraft ?? { unit: 'week' as const, every: 1 };
			repeatDraft =
				base.unit === 'week' && !base.weekdays?.length
					? { ...base, weekdays: [selected.getDay()] }
					: base;
			customOpen = true;
			return;
		}
		customOpen = false;
		const choice = choices.find((item) => item.id === id);
		repeatDraft = choice?.repeat ? patternOf(choice.repeat) : null;
	}

	function setEvery(value: number) {
		if (!repeatDraft || !Number.isInteger(value)) return;
		repeatDraft = { ...repeatDraft, every: Math.min(MAX_REPEAT_EVERY, Math.max(1, value)) };
	}

	function setUnit(unit: RepeatUnit) {
		if (!repeatDraft) return;
		repeatDraft =
			unit === 'week'
				? { unit, every: repeatDraft.every, weekdays: [selected.getDay()] }
				: { unit, every: repeatDraft.every };
	}

	function toggleWeekday(day: number) {
		if (!repeatDraft) return;
		const days = repeatDraft.weekdays ?? [selected.getDay()];
		const next = days.includes(day) ? days.filter((item) => item !== day) : [...days, day];
		// A weekly repeat comes on one day at least.
		if (!next.length) return;
		repeatDraft = { ...repeatDraft, weekdays: next.sort((left, right) => left - right) };
	}

	const showRemove = $derived(reminder != null);
	const primaryIsSave = $derived(uiStatus !== 'active');
	/** Waiting on the browser's notification permission prompt. */
	let awaitingPermission = $state(false);

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
		pick(d);
		monthYearOpen = false;
	}

	function setHour(hour: number) {
		const d = new Date(selected);
		d.setHours(hour);
		pick(d);
	}

	function setMinute(minute: number) {
		const d = new Date(selected);
		d.setMinutes(minute);
		pick(d);
	}

	// Typing a time: "tomorrow 9am", "v piatok večer". The languages are picked in Settings.
	let phrase = $state('');
	let reading = $state<ReminderPhrase | null>(null);
	let readers = $state.raw<PhraseReader[] | null>(null);
	/** What the controls showed before typing began; an unread or cleared text returns to it. */
	let beforeTyping: Date | null = null;
	let repeatBeforeTyping: RepeatPattern | null | undefined;
	let phraseInput = $state<HTMLInputElement | null>(null);
	const pickerId = $props.id();
	const resultId = `${pickerId}-read`;

	$effect(() => {
		let current = true;
		void loadPhraseReaders(uiStore.reminderLanguages).then((loaded) => {
			if (!current) return;
			readers = loaded;
			if (phrase) readPhrase(phrase);
		});
		return () => {
			current = false;
		};
	});

	const example = $derived(
		REMINDER_LANGUAGES.find((language) => language.code === uiStore.reminderLanguages[0])
			?.example ?? 'tomorrow 9am'
	);

	function readPhrase(text: string) {
		phrase = text;
		if (!text.trim()) {
			reading = null;
			if (beforeTyping) selected = beforeTyping;
			if (repeatBeforeTyping !== undefined) repeatDraft = repeatBeforeTyping;
			beforeTyping = null;
			repeatBeforeTyping = undefined;
			return;
		}
		beforeTyping ??= selected;
		if (repeatBeforeTyping === undefined) repeatBeforeTyping = repeatDraft;
		// A day typed without a time keeps the time the wheels showed before typing.
		const time = { hour: beforeTyping.getHours(), minute: beforeTyping.getMinutes() };
		reading = readers ? readReminderPhrase(text, readers, new Date(), time) : null;
		selected = reading ? new Date(reading.at) : beforeTyping;
		// "every monday at 9" sets the repeat; a plain time keeps the one picked before.
		repeatDraft = reading?.repeat ?? repeatBeforeTyping;
		customOpen = false;
	}

	function onPhraseKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.isComposing || !reading) return;
		event.preventDefault();
		void save();
	}

	function clearPhrase() {
		readPhrase('');
		phraseInput?.focus();
	}

	const readingLabel = $derived.by(() => {
		if (!reading) return '';
		// A typed repeat starts at its first time, which may come after the one typed.
		const at = new Date(reading.repeat ? draftFirst : reading.at);
		const when = at.toLocaleString([], {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			...(at.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
			hour: 'numeric',
			minute: '2-digit'
		});
		return reading.repeat && draftRepeat
			? `${when}, then ${describeRepeat(draftFirst, draftRepeat)}`
			: when;
	});
	/** Part of a sentence was read: say which part, so a missed word is not a surprise. */
	const readingPart = $derived(
		reading && reading.text.toLowerCase() !== phrase.trim().toLowerCase() ? reading.text : null
	);

	async function save() {
		// A first save triggers the browser's permission prompt, which stays open
		// until the user answers it. Save must show that wait, not sit silent.
		if (awaitingPermission) return;
		awaitingPermission = true;
		try {
			permission = await requestReminderPermission();
		} finally {
			awaitingPermission = false;
		}
		void registerAllReminderDevices();
		apply(draftFirst, draftRepeat);
	}
	function clear() {
		apply(null);
	}

	const { closeNote } = useEditorActions();
	let permission = $state(notificationPermission());

	/**
	 * What keeps this device from alerting while the app is closed, if anything.
	 * Push support comes first: Sync cannot help a browser without it. A permission
	 * not asked for yet needs no line, because Save asks.
	 */
	const closedAppAlerts = $derived.by(() => {
		if (!reminderPushSupported()) {
			return { text: "This browser can't show alerts while the app is closed.", sync: false };
		}
		if (!syncStore.isLoggedIn) {
			return { text: 'Closed-app alerts need Sync on this device.', sync: true };
		}
		if (syncStore.keyRetired) {
			return {
				text: 'Closed-app alerts are off until this workspace gets a new sync key.',
				sync: true
			};
		}
		if (permission === 'denied') {
			return { text: notificationsBlockedHint(pwaInstallStore.isStandalone), sync: false };
		}
		return null;
	});

	/** Sync settings open as they do from the cloud icon: over the feed, with any open note closed. */
	function openSyncSettings() {
		onClose();
		closeNote();
		uiStore.syncOpen = true;
	}

	let schedulePanel = $state<HTMLElement | null>(null);

	/**
	 * Where a host dialog puts focus on open: the typed field on a desktop, ready for
	 * "tomorrow 9am". A phone keeps its keyboard down until the field is tapped, so
	 * focus goes to the first date control, not a link above it.
	 */
	export function initialFocus(): HTMLElement | null {
		if (!isMobile && phraseInput) return phraseInput;
		return schedulePanel?.querySelector('button') ?? null;
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

	const repeatItemClass = cx(menuItem({ density: 'compact' }), styles.repeatItem);

	const calNavBtn = cx(
		iconButton({ variant: 'ghost', size: 'compact' }),
		css({ flexShrink: 0, color: 'inherit' })
	);
</script>

<div class={cx(d.panel, css({ w: '20rem', p: 'xl', gap: 0 }))}>
	<div class={cx(d.title, css({ mb: 'md', textStyle: 'subtitle' }))}>Reminder</div>

	<div class={styles.phrase}>
		<div class={styles.phraseField}>
			<input
				bind:this={phraseInput}
				type="text"
				class={cx(input({ variant: 'outline', size: 'md' }), styles.phraseInput)}
				value={phrase}
				oninput={(event) => readPhrase(event.currentTarget.value)}
				onkeydown={onPhraseKeydown}
				placeholder={`Type a time, like “${example}”`}
				aria-label="Type a date or time"
				aria-describedby={resultId}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				enterkeyhint="done"
			/>
			{#if phrase}
				<button
					type="button"
					class={cx(iconButton({ variant: 'ghost', size: 'compact' }), styles.phraseClear)}
					onclick={clearPhrase}
					aria-label="Clear the typed time"
				>
					<X size={16} aria-hidden="true" />
				</button>
			{/if}
		</div>
		<div id={resultId} aria-live="polite">
			{#if reading}
				<p class={styles.phraseRead}>
					<Check class={styles.phraseReadIcon} aria-hidden="true" />
					<span>{readingLabel}</span>
					{#if readingPart}
						<span class={styles.phraseMuted}>· from “{readingPart}”</span>
					{/if}
				</p>
			{:else if phrase.trim() && readers}
				<p class={styles.phraseUnread}>
					<TriangleAlert class={styles.phraseUnreadIcon} aria-hidden="true" />
					<span>No date or time in that. Try “{example}”, or pick one below.</span>
				</p>
			{/if}
		</div>
	</div>

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
				textStyle: 'bodyStrong'
			})}
		>
			{#if draftRepeat}
				<Repeat class={styles.statusGlyph} aria-hidden="true" />
			{:else}
				<AlarmClock class={styles.statusGlyph} aria-hidden="true" />
			{/if}
			<span class={styles.statusText}>{remainingLabel}</span>
		</div>
		{#if closedAppAlerts}
			<div class={css({ mt: '2xs', textStyle: 'caption' })}>
				{closedAppAlerts.text}
				{#if closedAppAlerts.sync}
					<button type="button" class={styles.syncLink} onclick={openSyncSettings}>
						Open Sync settings
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class={styles.section}>
		<div class={styles.sectionHeading}>Pick date & time</div>

		<div data-schedule-panel bind:this={schedulePanel}>
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

	<div class={styles.section}>
		<div class={styles.sectionHeading} id={`${pickerId}-repeat`}>Repeat</div>
		<Menu.Root
			positioning={{ placement: 'bottom-start', sameWidth: true, strategy: 'fixed' }}
			lazyMount
			unmountOnExit
		>
			<Menu.Trigger
				class={cx(button({ variant: 'secondary', size: 'md' }), styles.repeatTrigger)}
				aria-describedby={`${pickerId}-repeat`}
			>
				<Repeat class={styles.repeatGlyph} aria-hidden="true" />
				<span class={styles.ellipsis}>{repeatLabel}</span>
				<ChevronDown class={styles.repeatGlyph} aria-hidden="true" />
			</Menu.Trigger>
			<Menu.Positioner class={styles.repeatPositioner}>
				<Menu.Content class={cx(popover, styles.repeatMenu)} aria-label="Repeat">
					<Menu.RadioItemGroup
						value={choiceId}
						onValueChange={(details) => chooseRepeat(details.value)}
					>
						{#each choices as choice (choice.id)}
							<Menu.RadioItem value={choice.id} class={repeatItemClass}>
								<Menu.ItemIndicator><Check size={14} aria-hidden="true" /></Menu.ItemIndicator>
								<Menu.ItemText>{choice.label}</Menu.ItemText>
							</Menu.RadioItem>
						{/each}
						<Menu.RadioItem value="custom" class={repeatItemClass}>
							<Menu.ItemIndicator><Check size={14} aria-hidden="true" /></Menu.ItemIndicator>
							<Menu.ItemText>Custom…</Menu.ItemText>
						</Menu.RadioItem>
					</Menu.RadioItemGroup>
				</Menu.Content>
			</Menu.Positioner>
		</Menu.Root>
		{#if choiceId === 'custom' && repeatDraft}
			<div class={styles.custom} role="group" aria-label="Custom repeat">
				<label class={styles.every}>
					<span>Every</span>
					<input
						type="number"
						inputmode="numeric"
						min="1"
						max={MAX_REPEAT_EVERY}
						value={repeatDraft.every}
						oninput={(event) => setEvery(event.currentTarget.valueAsNumber)}
						class={cx(input({ variant: 'outline', size: 'sm' }), styles.everyInput)}
					/>
				</label>
				<div class={styles.units} role="group" aria-label="Repeat unit">
					{#each UNITS as unit (unit.value)}
						<button
							type="button"
							aria-pressed={repeatDraft.unit === unit.value}
							class={styles.option}
							onclick={() => setUnit(unit.value)}
						>
							{repeatDraft.every === 1 ? unit.one : unit.many}
						</button>
					{/each}
				</div>
				{#if repeatDraft.unit === 'week'}
					<div class={styles.weekdays} role="group" aria-label="On these days">
						{#each WEEKDAYS as day (day.value)}
							<button
								type="button"
								aria-pressed={(repeatDraft.weekdays ?? [selected.getDay()]).includes(day.value)}
								aria-label={day.name}
								class={styles.option}
								onclick={() => toggleWeekday(day.value)}
							>
								{day.short}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div
		class={css({
			display: 'flex',
			alignItems: 'center',
			gap: 'sm',
			borderTopWidth: 'hairline',
			borderColor: 'scrapscache.border',
			pt: 'lg'
		})}
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
			class={cx(
				button({ variant: 'secondary', size: 'md' }),
				css({ minW: '5.5rem' }),
				!primaryIsSave ? css({ ml: 'auto' }) : undefined
			)}
		>
			Cancel
		</button>
		{#if primaryIsSave}
			<button
				type="button"
				onclick={save}
				disabled={awaitingPermission}
				class={cx(button({ variant: 'primary', size: 'md' }), css({ minW: '5.5rem', ml: 'auto' }))}
			>
				{awaitingPermission ? 'Allow in the browser prompt…' : 'Save'}
			</button>
		{/if}
	</div>
</div>
