<script lang="ts">
	import { DatePicker } from '@ark-ui/svelte/date-picker';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { DateValue } from '@internationalized/date';
	import type { Snippet } from 'svelte';

	let { dayExtra }: { dayExtra?: Snippet<[DateValue]> } = $props();

	const navBtn =
		'rounded-full p-1.5 text-[var(--scrapscache-text-muted)] hover:bg-black/5 dark:hover:bg-white/10';
	const dayBtn =
		'relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm hover:bg-black/5 dark:hover:bg-white/10 data-[selected]:bg-[var(--scrapscache-accent)] data-[selected]:text-[var(--scrapscache-accent-foreground)] data-[in-range]:bg-[color-mix(in_srgb,var(--scrapscache-accent)_18%,transparent)] data-[today]:font-bold data-[today]:ring-1 data-[today]:ring-[var(--scrapscache-border)] data-[outside-range]:opacity-40';
	const monthYearSelect =
		'min-w-0 rounded-lg border border-[var(--scrapscache-border)] bg-[var(--scrapscache-surface)] px-1.5 py-1 text-sm font-semibold text-[var(--scrapscache-text)] outline-none';
</script>

<DatePicker.View view="day">
	<DatePicker.Context>
		{#snippet render(datePicker)}
			<DatePicker.ViewControl class="mb-2 flex items-center justify-between gap-2">
				<div class="flex min-w-0 flex-1 items-center gap-1.5">
					<DatePicker.MonthSelect class={monthYearSelect} />
					<DatePicker.YearSelect class={monthYearSelect} />
				</div>
				<div class="flex shrink-0 items-center">
					<DatePicker.PrevTrigger class={navBtn} aria-label="Previous month">
						<ChevronLeft size={16} />
					</DatePicker.PrevTrigger>
					<DatePicker.NextTrigger class={navBtn} aria-label="Next month">
						<ChevronRight size={16} />
					</DatePicker.NextTrigger>
				</div>
			</DatePicker.ViewControl>
			<DatePicker.Table class="w-full table-fixed">
				<DatePicker.TableHead>
					<DatePicker.TableRow
						class="text-center text-xs font-medium text-[var(--scrapscache-text-muted)]"
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
