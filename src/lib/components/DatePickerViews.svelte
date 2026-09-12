<script lang="ts">
	import { DatePicker } from '@ark-ui/svelte/date-picker';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import type { DateValue } from '@internationalized/date';
	import type { Snippet } from 'svelte';
	import { cva, css } from 'styled-system/css';
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

	const viewControlClass = css({
		mb: '0.5rem',
		display: 'flex',
		h: '2.25rem',
		alignItems: 'center',
		justifyContent: 'space-between'
	});

	const viewBtn = css({
		rounded: 'lg',
		px: '0.5rem',
		py: '0.25rem',
		fontSize: 'sm',
		fontWeight: '600',
		color: 'scrapscache.text',
		cursor: 'pointer',
		transition: 'colors 150ms ease',
		_hover: { bg: { base: 'black/5', _dark: 'white/10' } }
	});

	const gridBtn = cva({
		base: {
			mx: 'auto',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			fontSize: 'sm',
			fontWeight: 'medium',
			cursor: 'pointer',
			transition: 'colors 150ms ease',
			_hover: { bg: { base: 'black/5', _dark: 'white/10' } },
			_selected: {
				bg: 'scrapscache.accent',
				color: 'scrapscache.accentForeground',
				fontWeight: '600'
			},
			'&[data-today]': {
				ringWidth: '1px',
				ringColor: 'scrapscache.border'
			},
			_focusVisible: {
				outline: 'none',
				ringWidth: '2px',
				ringColor: 'scrapscache.accent'
			}
		},
		variants: {
			kind: {
				day: {
					position: 'relative',
					h: '2rem',
					w: '2rem',
					rounded: 'full',
					'&[data-in-range]:not([data-range-start]):not([data-range-end])': {
						bg: 'scrapscache.accent/18',
						color: 'scrapscache.text',
						fontWeight: 'normal'
					},
					'&[data-focus]:not([data-selected]):not([data-in-range])': {
						bg: 'transparent !important'
					},
					'&[data-selected] .reminder-dot, &[data-range-start] .reminder-dot, &[data-range-end] .reminder-dot':
						{
							bg: 'scrapscache.accentForeground !important'
						},
					'&[data-outside-range]': {
						opacity: 0.3,
						pointerEvents: 'none'
					}
				},
				month: {
					h: '2.25rem',
					w: '3.5rem',
					rounded: 'lg'
				}
			}
		}
	});

	const tableClass = css({
		w: 'full',
		tableLayout: 'fixed',
		h: '13.5rem'
	});

	const panelClass = css({
		minH: '16.25rem',
		display: 'flex',
		flexDirection: 'column',
		'& [data-part="view"]:not([hidden])': {
			display: 'flex',
			flexDirection: 'column'
		},
		'& .calendar-table-fill [data-part="table-body"]': {
			h: '100%'
		},
		'& .calendar-table-fill [data-part="table-row"]': {
			h: 'calc(13.5rem / 3)'
		},
		'& .calendar-table-fill [data-part="table-cell"]': {
			h: 'inherit',
			verticalAlign: 'middle'
		}
	});
</script>

<div class={panelClass}>
	<DatePicker.View view="day">
		<DatePicker.Context>
			{#snippet render(datePicker)}
				<DatePicker.ViewControl class={viewControlClass}>
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
				<DatePicker.Table class={`calendar-table ${tableClass}`}>
					<DatePicker.TableHead>
						<DatePicker.TableRow
							class={css({
								h: '1.5rem',
								textAlign: 'center',
								fontSize: 'xs',
								fontWeight: 'medium',
								color: 'scrapscache.textMuted'
							})}
						>
							{#each datePicker().weekDays as weekDay (weekDay.value.toString())}
								<DatePicker.TableHeader>{weekDay.narrow}</DatePicker.TableHeader>
							{/each}
						</DatePicker.TableRow>
					</DatePicker.TableHead>
					<DatePicker.TableBody>
						{#each datePicker().weeks as week (week[0].toString())}
							<DatePicker.TableRow class={css({ textAlign: 'center' })}>
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
				<DatePicker.ViewControl
					class={css({
						mb: '0.5rem',
						display: 'flex',
						h: '2.25rem',
						alignItems: 'center',
						justifyContent: 'space-between'
					})}
				>
					<DatePicker.PrevTrigger class={navBtn} aria-label="Previous month">
						<ChevronLeft size={16} />
					</DatePicker.PrevTrigger>
					<DatePicker.ViewTrigger
						class={css({
							rounded: 'lg',
							px: '0.5rem',
							py: '0.25rem',
							fontSize: 'sm',
							fontWeight: '600',
							color: 'scrapscache.text',
							cursor: 'pointer',
							transition: 'colors 150ms ease',
							_hover: { bg: { base: 'black/5', _dark: 'white/10' } }
						})}
					>
						<DatePicker.RangeText />
					</DatePicker.ViewTrigger>
					<DatePicker.NextTrigger class={navBtn} aria-label="Next year">
						<ChevronRight size={16} />
					</DatePicker.NextTrigger>
				</DatePicker.ViewControl>
				<DatePicker.Table class={`calendar-table calendar-table-fill ${tableClass}`}>
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
				<DatePicker.ViewControl class={viewControlClass}>
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
				<DatePicker.Table class={`calendar-table calendar-table-fill ${tableClass}`}>
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
