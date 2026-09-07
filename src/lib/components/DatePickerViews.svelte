<script lang="ts">
	import { DatePicker } from '@ark-ui/svelte/date-picker';
	import { ChevronDown, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { DateValue } from '@internationalized/date';
	import type { Snippet } from 'svelte';

	let { dayExtra }: { dayExtra?: Snippet<[DateValue]> } = $props();

	const navBtn =
		'rounded-full p-1.5 text-[var(--scrapscache-text-muted)] hover:bg-black/5 dark:hover:bg-white/10';
	const dayBtn =
		'relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm hover:bg-black/5 dark:hover:bg-white/10 data-[selected]:bg-[var(--scrapscache-accent)] data-[selected]:text-[var(--scrapscache-accent-foreground)] data-[in-range]:bg-[color-mix(in_srgb,var(--scrapscache-accent)_18%,transparent)] data-[today]:font-bold data-[today]:ring-1 data-[today]:ring-[var(--scrapscache-border)] data-[outside-range]:opacity-40';
	const monthYearSelect =
		'min-w-0 cursor-pointer appearance-none bg-transparent py-1 pr-5 pl-1.5 text-sm font-semibold text-[var(--scrapscache-text)] outline-none';
</script>

<DatePicker.View view="day">
	<DatePicker.Context>
		{#snippet render(datePicker)}
			<DatePicker.ViewControl class="mb-2 flex items-center justify-between gap-2">
				<div class="flex min-w-0 flex-1 items-center">
					<div class="relative min-w-0 rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
						<DatePicker.MonthSelect class={monthYearSelect} />
						<ChevronDown
							class="pointer-events-none absolute top-1/2 right-0.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--scrapscache-text-muted)]"
							aria-hidden="true"
						/>
					</div>
					<div class="relative shrink-0 rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
						<DatePicker.YearSelect class={[monthYearSelect, 'w-[3.75rem]']} />
						<ChevronDown
							class="pointer-events-none absolute top-1/2 right-0.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--scrapscache-text-muted)]"
							aria-hidden="true"
						/>
					</div>
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
