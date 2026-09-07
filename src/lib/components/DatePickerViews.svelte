<script lang="ts">
	import { DatePicker } from '@ark-ui/svelte/date-picker';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { DateValue } from '@internationalized/date';
	import type { Snippet } from 'svelte';

	let { dayExtra }: { dayExtra?: Snippet<[DateValue]> } = $props();

	const navBtn =
		'rounded-full p-1.5 text-[var(--scrapscache-text-muted)] hover:bg-black/5 dark:hover:bg-white/10';
	const viewBtn =
		'rounded-lg px-2 py-1 text-sm font-semibold text-[var(--scrapscache-text)] hover:bg-black/5 dark:hover:bg-white/10';
	const dayBtn =
		'relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm hover:bg-black/5 dark:hover:bg-white/10 data-[selected]:bg-[var(--scrapscache-accent)] data-[selected]:text-[var(--scrapscache-accent-foreground)] data-[in-range]:bg-[color-mix(in_srgb,var(--scrapscache-accent)_18%,transparent)] data-[today]:font-bold data-[today]:ring-1 data-[today]:ring-[var(--scrapscache-border)] data-[outside-range]:opacity-40';
	const monthBtn =
		'flex h-full min-h-10 w-full items-center justify-center rounded-lg text-sm hover:bg-black/5 dark:hover:bg-white/10 data-[selected]:bg-[var(--scrapscache-accent)] data-[selected]:text-[var(--scrapscache-accent-foreground)] data-[focus]:bg-black/[0.06] dark:data-[focus]:bg-white/[0.08] data-[today]:ring-1 data-[today]:ring-[var(--scrapscache-border)]';
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
										<DatePicker.TableCellTrigger class={dayBtn}>
											{day.day}
											{@render dayExtra?.(day)}
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
</style>
