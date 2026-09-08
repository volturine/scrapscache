<script lang="ts">
	import { DatePicker } from '@ark-ui/svelte/date-picker';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { DateValue } from '@internationalized/date';
	import type { Snippet } from 'svelte';

	let {
		dayExtra,
		onDayClick,
		onDayPointerDown,
		onDayPointerUp,
		onDayPointerLeave,
		onDayPointerCancel,
		onDayContextMenu
	}: {
		dayExtra?: Snippet<[DateValue]>;
		onDayClick?: (day: DateValue, e: MouseEvent) => void;
		onDayPointerDown?: (day: DateValue, e: PointerEvent) => void;
		onDayPointerUp?: (day: DateValue, e: PointerEvent) => void;
		onDayPointerLeave?: (day: DateValue, e: PointerEvent) => void;
		onDayPointerCancel?: (day: DateValue, e: PointerEvent) => void;
		onDayContextMenu?: (day: DateValue, e: MouseEvent) => void;
	} = $props();

	const navBtn =
		'rounded-full p-1.5 text-[var(--scrapscache-text-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/10';
	const viewBtn =
		'rounded-lg px-2 py-1 text-sm font-semibold text-[var(--scrapscache-text)] transition-colors hover:bg-black/5 dark:hover:bg-white/10';
	const dayBtn =
		'relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10 data-[selected]:bg-[var(--scrapscache-accent)] data-[selected]:text-[var(--scrapscache-accent-foreground)] data-[selected]:font-semibold data-[today]:ring-1 data-[today]:ring-[var(--scrapscache-border)] data-[outside-range]:opacity-30 data-[outside-range]:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--scrapscache-accent)]';
	const monthBtn =
		'mx-auto flex h-9 w-14 items-center justify-center rounded-lg text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10 data-[selected]:bg-[var(--scrapscache-accent)] data-[selected]:text-[var(--scrapscache-accent-foreground)] data-[selected]:font-semibold data-[today]:ring-1 data-[today]:ring-[var(--scrapscache-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--scrapscache-accent)]';
</script>

<div class="calendar-panel">
	<DatePicker.View view="day">
		<DatePicker.Context>
			{#snippet render(datePicker)}
				<DatePicker.ViewControl class="mb-2 flex h-9 items-center justify-between">
					<DatePicker.PrevTrigger class={navBtn} aria-label="Previous month">
						<ChevronLeft size={16} />
					</DatePicker.PrevTrigger>
					<DatePicker.ViewTrigger class={viewBtn}>
						<DatePicker.RangeText />
					</DatePicker.ViewTrigger>
					<DatePicker.NextTrigger class={navBtn} aria-label="Next month">
						<ChevronRight size={16} />
					</DatePicker.NextTrigger>
				</DatePicker.ViewControl>
				<DatePicker.Table class="calendar-table w-full table-fixed">
					<DatePicker.TableHead>
						<DatePicker.TableRow
							class="h-6 text-center text-xs font-medium text-[var(--scrapscache-text-muted)]"
						>
							{#each datePicker().weekDays as weekDay (weekDay.value.toString())}
								<DatePicker.TableHeader>{weekDay.narrow}</DatePicker.TableHeader>
							{/each}
						</DatePicker.TableRow>
					</DatePicker.TableHead>
					<DatePicker.TableBody>
						{#each datePicker().weeks as week (week[0].toString())}
							<DatePicker.TableRow class="text-center">
								{#each week as day (day.toString())}
									<DatePicker.TableCell value={day}>
										{#if onDayClick || onDayPointerDown}
											<DatePicker.TableCellTrigger>
												{#snippet asChild(triggerProps)}
													{@const { onClick, onclick, ...safeProps } = triggerProps() as Record<
														string,
														any
													>}
													<button
														type="button"
														{...safeProps}
														class={dayBtn}
														onpointerdown={(e) => onDayPointerDown?.(day, e)}
														onpointerup={(e) => onDayPointerUp?.(day, e)}
														onpointerleave={(e) => onDayPointerLeave?.(day, e)}
														onpointercancel={(e) => onDayPointerCancel?.(day, e)}
														oncontextmenu={(e) => {
															e.preventDefault();
															onDayContextMenu?.(day, e);
														}}
														onclick={(e) => {
															e.preventDefault();
															onDayClick?.(day, e);
														}}
													>
														{day.day}
														{@render dayExtra?.(day)}
													</button>
												{/snippet}
											</DatePicker.TableCellTrigger>
										{:else}
											<DatePicker.TableCellTrigger class={dayBtn}>
												{day.day}
												{@render dayExtra?.(day)}
											</DatePicker.TableCellTrigger>
										{/if}
									</DatePicker.TableCell>
								{/each}
							</DatePicker.TableRow>
						{/each}
					</DatePicker.TableBody>
				</DatePicker.Table>
			{/snippet}
		</DatePicker.Context>
	</DatePicker.View>

	<DatePicker.View view="month">
		<DatePicker.Context>
			{#snippet render(datePicker)}
				<DatePicker.ViewControl class="mb-2 flex h-9 items-center justify-between">
					<DatePicker.PrevTrigger class={navBtn} aria-label="Previous year">
						<ChevronLeft size={16} />
					</DatePicker.PrevTrigger>
					<DatePicker.ViewTrigger class={viewBtn}>
						<DatePicker.RangeText />
					</DatePicker.ViewTrigger>
					<DatePicker.NextTrigger class={navBtn} aria-label="Next year">
						<ChevronRight size={16} />
					</DatePicker.NextTrigger>
				</DatePicker.ViewControl>
				<DatePicker.Table class="calendar-table calendar-table-fill w-full table-fixed">
					<DatePicker.TableBody>
						{#each datePicker().getMonthsGrid({ columns: 4, format: 'short' }) as months, row (row)}
							<DatePicker.TableRow>
								{#each months as month (month.value)}
									<DatePicker.TableCell value={month.value}>
										<DatePicker.TableCellTrigger class={monthBtn}>
											{month.label}
										</DatePicker.TableCellTrigger>
									</DatePicker.TableCell>
								{/each}
							</DatePicker.TableRow>
						{/each}
					</DatePicker.TableBody>
				</DatePicker.Table>
			{/snippet}
		</DatePicker.Context>
	</DatePicker.View>

	<DatePicker.View view="year">
		<DatePicker.Context>
			{#snippet render(datePicker)}
				<DatePicker.ViewControl class="mb-2 flex h-9 items-center justify-between">
					<DatePicker.PrevTrigger class={navBtn} aria-label="Previous decade">
						<ChevronLeft size={16} />
					</DatePicker.PrevTrigger>
					<DatePicker.ViewTrigger class={viewBtn}>
						<DatePicker.RangeText />
					</DatePicker.ViewTrigger>
					<DatePicker.NextTrigger class={navBtn} aria-label="Next decade">
						<ChevronRight size={16} />
					</DatePicker.NextTrigger>
				</DatePicker.ViewControl>
				<DatePicker.Table class="calendar-table calendar-table-fill w-full table-fixed">
					<DatePicker.TableBody>
						{#each datePicker().getYearsGrid({ columns: 4 }) as years, row (row)}
							<DatePicker.TableRow>
								{#each years as year (year.value)}
									<DatePicker.TableCell value={year.value}>
										<DatePicker.TableCellTrigger class={monthBtn}>
											{year.label}
										</DatePicker.TableCellTrigger>
									</DatePicker.TableCell>
								{/each}
							</DatePicker.TableRow>
						{/each}
					</DatePicker.TableBody>
				</DatePicker.Table>
			{/snippet}
		</DatePicker.Context>
	</DatePicker.View>
</div>

<style>
	.calendar-panel {
		min-height: 16.25rem;
	}
	.calendar-panel :global([data-part='view']:not([hidden])) {
		display: flex;
		flex-direction: column;
	}
	.calendar-panel :global(.calendar-table) {
		height: 13.5rem;
	}
	.calendar-panel :global(.calendar-table-fill [data-part='table-body']) {
		height: 100%;
	}
	.calendar-panel :global(.calendar-table-fill [data-part='table-row']) {
		height: calc(13.5rem / 3);
	}
	.calendar-panel :global(.calendar-table-fill [data-part='table-cell']) {
		height: inherit;
		vertical-align: middle;
	}

	/* Never apply dark block background on roving focus */
	.calendar-panel
		:global(
			[data-part='table-cell-trigger'][data-focus]:not([data-selected]):not([data-in-range])
		) {
		background-color: transparent !important;
	}

	/* In-range highlighting: in-between days get soft accent tint, not solid accent */
	.calendar-panel
		:global(
			[data-part='table-cell-trigger'][data-in-range]:not([data-range-start]):not([data-range-end])
		) {
		background-color: color-mix(in srgb, var(--scrapscache-accent) 18%, transparent) !important;
		color: var(--scrapscache-text) !important;
		font-weight: normal !important;
	}

	/* Selected day dots */
	.calendar-panel :global([data-part='table-cell-trigger'][data-selected] .reminder-dot),
	.calendar-panel :global([data-part='table-cell-trigger'][data-range-start] .reminder-dot),
	.calendar-panel :global([data-part='table-cell-trigger'][data-range-end] .reminder-dot) {
		background-color: var(--scrapscache-accent-foreground) !important;
	}
</style>
