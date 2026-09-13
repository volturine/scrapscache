<script lang="ts">
	import {
		datePickerPanel as panel,
		datePickerViewControl as viewControl,
		datePickerViewButton as viewButton,
		datePickerTable as table,
		datePickerWeekHeader as weekHeader,
		datePickerWeekRow as weekRow,
		datePickerDayCell as dayCell,
		datePickerGridBtn as gridBtn
	} from '$panda/styles';
	import { DatePicker } from '@ark-ui/svelte/date-picker';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { DateValue } from '@internationalized/date';
	import type { Snippet } from 'svelte';
	import { iconButton } from 'styled-system/recipes';

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

	const navBtn = iconButton({ variant: 'ghost', size: 'xs' });
</script>

<div class={panel}>
	<DatePicker.View view="day">
		<DatePicker.Context>
			{#snippet render(datePicker)}
				<DatePicker.ViewControl class={viewControl}>
					<DatePicker.PrevTrigger class={navBtn} aria-label="Previous month">
						<ChevronLeft size={16} />
					</DatePicker.PrevTrigger>
					<DatePicker.ViewTrigger class={viewButton}>
						<DatePicker.RangeText />
					</DatePicker.ViewTrigger>
					<DatePicker.NextTrigger class={navBtn} aria-label="Next month">
						<ChevronRight size={16} />
					</DatePicker.NextTrigger>
				</DatePicker.ViewControl>
				<DatePicker.Table class={['calendar-table', table]}>
					<DatePicker.TableHead>
						<DatePicker.TableRow class={weekHeader}>
							{#each datePicker().weekDays as weekDay (weekDay.value.toString())}
								<DatePicker.TableHeader>{weekDay.narrow}</DatePicker.TableHeader>
							{/each}
						</DatePicker.TableRow>
					</DatePicker.TableHead>
					<DatePicker.TableBody>
						{#each datePicker().weeks as week (week[0].toString())}
							<DatePicker.TableRow class={weekRow}>
								{#each week as day (day.toString())}
									<DatePicker.TableCell value={day} class={dayCell}>
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
														class={gridBtn({ kind: 'day' })}
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
											<DatePicker.TableCellTrigger class={gridBtn({ kind: 'day' })}>
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
				<DatePicker.ViewControl class={viewControl}>
					<DatePicker.PrevTrigger class={navBtn} aria-label="Previous month">
						<ChevronLeft size={16} />
					</DatePicker.PrevTrigger>
					<DatePicker.ViewTrigger class={viewButton}>
						<DatePicker.RangeText />
					</DatePicker.ViewTrigger>
					<DatePicker.NextTrigger class={navBtn} aria-label="Next year">
						<ChevronRight size={16} />
					</DatePicker.NextTrigger>
				</DatePicker.ViewControl>
				<DatePicker.Table class={['calendar-table', 'calendar-table-fill', table]}>
					<DatePicker.TableBody>
						{#each datePicker().getMonthsGrid({ columns: 4, format: 'short' }) as months, row (row)}
							<DatePicker.TableRow>
								{#each months as month (month.value)}
									<DatePicker.TableCell value={month.value}>
										<DatePicker.TableCellTrigger class={gridBtn({ kind: 'month' })}>
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
				<DatePicker.ViewControl class={viewControl}>
					<DatePicker.PrevTrigger class={navBtn} aria-label="Previous decade">
						<ChevronLeft size={16} />
					</DatePicker.PrevTrigger>
					<DatePicker.ViewTrigger class={viewButton}>
						<DatePicker.RangeText />
					</DatePicker.ViewTrigger>
					<DatePicker.NextTrigger class={navBtn} aria-label="Next decade">
						<ChevronRight size={16} />
					</DatePicker.NextTrigger>
				</DatePicker.ViewControl>
				<DatePicker.Table class={['calendar-table', 'calendar-table-fill', table]}>
					<DatePicker.TableBody>
						{#each datePicker().getYearsGrid({ columns: 4 }) as years, row (row)}
							<DatePicker.TableRow>
								{#each years as year (year.value)}
									<DatePicker.TableCell value={year.value}>
										<DatePicker.TableCellTrigger class={gridBtn({ kind: 'month' })}>
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
