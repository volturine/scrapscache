<script lang="ts">
	import { DatePicker } from '@ark-ui/svelte/date-picker';
	import { Menu } from '@ark-ui/svelte/menu';
	import { ChevronDown, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { DateValue } from '@internationalized/date';
	import type { Snippet } from 'svelte';

	let { dayExtra }: { dayExtra?: Snippet<[DateValue]> } = $props();

	const navBtn =
		'rounded-full p-1.5 text-[var(--scrapscache-text-muted)] hover:bg-black/5 dark:hover:bg-white/10';
	const dayBtn =
		'relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm hover:bg-black/5 dark:hover:bg-white/10 data-[selected]:bg-[var(--scrapscache-accent)] data-[selected]:text-[var(--scrapscache-accent-foreground)] data-[in-range]:bg-[color-mix(in_srgb,var(--scrapscache-accent)_18%,transparent)] data-[today]:font-bold data-[today]:ring-1 data-[today]:ring-[var(--scrapscache-border)] data-[outside-range]:opacity-40';
	const triggerBtn =
		'inline-flex cursor-pointer items-center gap-0.5 rounded-lg py-1 pl-1.5 pr-1 text-sm font-semibold text-[var(--scrapscache-text)] outline-none hover:bg-black/5 dark:hover:bg-white/10';
	const menuItem =
		'block w-full cursor-pointer px-3 py-1.5 text-left text-sm text-[var(--scrapscache-text)] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]';

	function scrollCurrentIntoView(value: string) {
		requestAnimationFrame(() => {
			document
				.querySelector(`[data-part="content"][data-state="open"] [data-value="${value}"]`)
				?.scrollIntoView({ block: 'center' });
		});
	}
</script>

<DatePicker.View view="day">
	<DatePicker.Context>
		{#snippet render(datePicker)}
			{@const visible = datePicker().visibleRange.start}
			{@const months = datePicker().getMonths()}
			{@const years = datePicker().getYears()}
			{@const monthLabel = months.find((month) => month.value === visible.month)?.label}
			<DatePicker.ViewControl class="relative z-20 mb-2 flex items-center justify-between gap-2">
				<div class="flex min-w-0 flex-1 items-center">
					<Menu.Root
						positioning={{ placement: 'bottom-start', gutter: 4 }}
						onOpenChange={(details) => {
							if (details.open) scrollCurrentIntoView(String(visible.month));
						}}
					>
						<Menu.Trigger class={triggerBtn} aria-label="Select month">
							{monthLabel}
							<ChevronDown
								class="h-3.5 w-3.5 text-[var(--scrapscache-text-muted)]"
								aria-hidden="true"
							/>
						</Menu.Trigger>
						<Menu.Positioner class="z-50">
							<Menu.Content
								class="scrapscache-popover max-h-64 min-w-36 overflow-y-auto py-1"
								aria-label="Months"
							>
								{#each months as month (month.value)}
									<Menu.Item
										value={String(month.value)}
										onclick={() => datePicker().focusMonth(month.value)}
										class={[
											menuItem,
											month.value === visible.month &&
												'bg-black/[0.06] font-semibold dark:bg-white/[0.08]'
										]}
									>
										{month.label}
									</Menu.Item>
								{/each}
							</Menu.Content>
						</Menu.Positioner>
					</Menu.Root>
					<Menu.Root
						positioning={{ placement: 'bottom-start', gutter: 4 }}
						onOpenChange={(details) => {
							if (details.open) scrollCurrentIntoView(String(visible.year));
						}}
					>
						<Menu.Trigger class={triggerBtn} aria-label="Select year">
							{visible.year}
							<ChevronDown
								class="h-3.5 w-3.5 text-[var(--scrapscache-text-muted)]"
								aria-hidden="true"
							/>
						</Menu.Trigger>
						<Menu.Positioner class="z-50">
							<Menu.Content
								class="scrapscache-popover max-h-64 min-w-24 overflow-y-auto py-1"
								aria-label="Years"
							>
								{#each years as year (year.value)}
									<Menu.Item
										value={String(year.value)}
										onclick={() => datePicker().focusYear(year.value)}
										class={[
											menuItem,
											year.value === visible.year &&
												'bg-black/[0.06] font-semibold dark:bg-white/[0.08]'
										]}
									>
										{year.label}
									</Menu.Item>
								{/each}
							</Menu.Content>
						</Menu.Positioner>
					</Menu.Root>
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
