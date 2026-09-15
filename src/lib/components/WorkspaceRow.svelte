<script lang="ts">
	import { truncate, workspaceStyles, workspacePanelBtn as panelBtn } from '$panda/styles';
	import type { Snippet } from 'svelte';
	import { Check, ChevronDown, CloudOff, Download, Pencil, TriangleAlert, X } from '@lucide/svelte';
	import { css, cx } from 'styled-system/css';
	import { input as inputRecipe } from 'styled-system/recipes';
	import { hstack } from 'styled-system/patterns';

	let {
		name,
		caption,
		active,
		disabled,
		expanded,
		icon,
		onselect,
		onexport,
		onexpand,
		onrename,
		onunlink,
		onbusychange,
		actions,
		danger
	}: {
		name: string;
		caption: string;
		active: boolean;
		disabled: boolean;
		expanded: boolean;
		icon: Snippet;
		onselect: () => void;
		onexport: () => void;
		onexpand: () => void;
		onrename?: (next: string) => Promise<boolean>;
		onunlink?: () => Promise<boolean>;
		onbusychange: (holdsEscape: boolean) => void;
		actions?: Snippet;
		danger?: Snippet;
	} = $props();

	const styles = workspaceStyles;
	const ACTIONS_WIDTH = 152;
	const COMMIT_RATIO = 0.55;
	const OVERSWIPE_RESISTANCE = 0.7;
	const RUBBER_BAND = 0.25;
	const FLICK_VELOCITY = 0.4;
	const SLOP = 8;

	let mode = $state<'idle' | 'rename' | 'confirm'>('idle');
	let working = $state<'rename' | 'unlink' | null>(null);
	let draft = $state('');
	let swipeOpen = $state(false);
	let offset = $state(0);
	let dragging = $state(false);
	let armed = $state(false);
	let rowElement: HTMLDivElement | undefined;
	let renameInput: HTMLInputElement | undefined;
	let trigger: HTMLElement | null = null;
	let start: { x: number; y: number; offset: number } | null = null;
	let last = { x: 0, time: 0 };
	let velocity = 0;
	let swiped = false;

	const progress = $derived(Math.min(1, Math.max(0, -offset / ACTIONS_WIDTH)));
	const locked = $derived(disabled || working !== null);
	const nameFieldClass = $derived(
		cx(inputRecipe({ variant: 'outline', size: 'sm' }), css({ w: 'full', font: 'inherit' }))
	);
	const chevronClass = $derived(cx(styles.chevron, expanded && styles.chevronOpen));

	function notifyBusy() {
		onbusychange(mode !== 'idle' || swipeOpen);
	}

	function setMode(next: typeof mode) {
		mode = next;
		notifyBusy();
	}

	function takeFocus(node: HTMLElement) {
		node.focus();
		return () => {
			const focused = document.activeElement;
			if (focused === node || focused === document.body || focused === null) trigger?.focus();
		};
	}

	function renameField(node: HTMLInputElement) {
		renameInput = node;
		const release = takeFocus(node);
		node.select();
		return () => {
			if (renameInput === node) renameInput = undefined;
			release();
		};
	}

	function commitDistance() {
		return Math.max(ACTIONS_WIDTH + 40, (rowElement?.clientWidth ?? 0) * COMMIT_RATIO);
	}

	function settle(next: boolean) {
		swipeOpen = next;
		offset = next ? -ACTIONS_WIDTH : 0;
		notifyBusy();
	}

	function down(event: PointerEvent) {
		if (locked || mode !== 'idle' || event.pointerType !== 'touch') return;
		start = { x: event.clientX, y: event.clientY, offset: swipeOpen ? -ACTIONS_WIDTH : 0 };
		last = { x: event.clientX, time: event.timeStamp };
		velocity = 0;
		swiped = false;
	}

	function move(event: PointerEvent) {
		if (!start) return;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (!dragging) {
			if (Math.abs(dx) < SLOP || Math.abs(dy) > Math.abs(dx) * 2) return;
			dragging = true;
			swiped = true;
		}
		const elapsed = event.timeStamp - last.time;
		if (elapsed > 0) velocity = (event.clientX - last.x) / elapsed;
		last = { x: event.clientX, time: event.timeStamp };
		const raw = start.offset + dx;
		offset =
			raw > 0
				? raw * RUBBER_BAND
				: raw < -ACTIONS_WIDTH
					? -ACTIONS_WIDTH + (raw + ACTIONS_WIDTH) * OVERSWIPE_RESISTANCE
					: raw;
		const nextArmed = -offset >= commitDistance();
		if (nextArmed !== armed) {
			armed = nextArmed;
			if (nextArmed) navigator.vibrate?.(8);
		}
	}

	function end() {
		if (!dragging) {
			start = null;
			return;
		}
		dragging = false;
		start = null;
		if (armed) {
			armed = false;
			askUnlink();
			return;
		}
		if (velocity < -FLICK_VELOCITY) settle(true);
		else if (velocity > FLICK_VELOCITY) settle(false);
		else settle(-offset > ACTIONS_WIDTH / 2);
	}

	function cancelDrag() {
		if (!start) return;
		dragging = false;
		armed = false;
		start = null;
		settle(swipeOpen);
	}

	function startRename(event: MouseEvent) {
		if (!onrename) return;
		trigger = event.currentTarget as HTMLElement;
		draft = name;
		setMode('rename');
		settle(false);
	}

	function askUnlink(event?: MouseEvent) {
		if (!onunlink) return;
		trigger = (event?.currentTarget as HTMLElement | undefined) ?? null;
		setMode('confirm');
		settle(false);
	}

	function cancel() {
		setMode('idle');
		draft = name;
	}

	async function saveRename() {
		const next = draft.trim();
		if (!onrename || !next || next === name) {
			cancel();
			return;
		}
		working = 'rename';
		const saved = await onrename(next);
		working = null;
		if (saved) setMode('idle');
		else renameInput?.focus();
	}

	async function confirmUnlink() {
		if (!onunlink) return;
		working = 'unlink';
		const done = await onunlink();
		working = null;
		if (done) setMode('idle');
	}

	function onDocumentPointerDown(event: PointerEvent) {
		if (working || !rowElement || rowElement.contains(event.target as Node)) return;
		if (swipeOpen) settle(false);
		if (mode === 'rename') void saveRename();
		else if (mode === 'confirm') cancel();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || (mode === 'idle' && !swipeOpen && !expanded)) return;
		event.preventDefault();
		if (mode !== 'idle') cancel();
		else if (swipeOpen) settle(false);
		else onexpand();
	}
</script>

<svelte:document
	onkeydown={onKeyDown}
	onpointerdown={onDocumentPointerDown}
	onpointermove={move}
	onpointerup={end}
	onpointercancel={cancelDrag}
/>

<div
	bind:this={rowElement}
	class={`row ${styles.row}`}
	class:open={expanded || swipeOpen}
	class:armed
	class:dragging
	class:editing={mode !== 'idle'}
	style:--swipe-offset={`${offset}px`}
	style:--swipe-progress={progress}
	tabindex="-1"
>
	<div class={`actions ${styles.actions}`} aria-hidden="true">
		{#if onrename}
			<button
				type="button"
				class={`tile ${styles.tile}`}
				disabled={locked}
				title="Rename"
				aria-label="Rename {name}"
				onclick={startRename}
			>
				<Pencil size={16} aria-hidden="true" /><span class={styles.tileLabel}>Rename</span>
			</button>
		{/if}
		{#if onunlink}
			<button
				type="button"
				class={`tile tile-unlink ${styles.tile} ${styles.tileUnlink}`}
				disabled={locked}
				title="Unlink"
				aria-label="Unlink {name}"
				onclick={askUnlink}
			>
				<CloudOff size={16} aria-hidden="true" /><span class={styles.tileLabel}
					>{armed ? 'Release' : 'Unlink'}</span
				>
			</button>
		{/if}
	</div>

	<div class={`front ${styles.frontBase}`} class:active data-front>
		{#if mode === 'confirm'}
			<div class={`panel confirm ${styles.panel}`}>
				<span class={`${styles.glyph} panel-glyph`} aria-hidden="true"
					><TriangleAlert size={18} /></span
				>
				<p class={cx(styles.content, css({ fontSize: 'compact' }))}>
					Unlink <strong>{name}</strong>?<span class={styles.caption}
						>Notes stay here as a private workspace.</span
					>
				</p>
				<div class={`panel-actions ${hstack({ gap: 'xs', flexShrink: 0 })}`}>
					<button
						type="button"
						class={panelBtn.neutral}
						{@attach takeFocus}
						disabled={working !== null}
						aria-label="Keep {name} linked"
						onclick={cancel}>Cancel</button
					>
					<button
						type="button"
						class={panelBtn.danger}
						disabled={locked}
						aria-label="Unlink {name} from this device"
						onclick={() => void confirmUnlink()}
						>{working === 'unlink' ? 'Unlinking…' : 'Unlink'}</button
					>
				</div>
			</div>
		{:else if mode === 'rename'}
			<form
				class={styles.panel}
				onsubmit={(event) => {
					event.preventDefault();
					void saveRename();
				}}
			>
				<span class={styles.glyph} aria-hidden="true">{@render icon()}</span>
				<span class={styles.content}>
					<input
						{@attach renameField}
						bind:value={draft}
						class={nameFieldClass}
						maxlength="60"
						spellcheck="false"
						disabled={working !== null}
						aria-label="Workspace name"
					/>
					<span class={styles.caption}>
						{#if working === 'rename'}Saving…{:else}<span
								class={css({ display: { base: 'none', sm: 'inline' } })}
								>Enter saves · Esc cancels</span
							><span class={css({ display: { base: 'inline', sm: 'none' } })}>{caption}</span>{/if}
					</span>
				</span>
				<div class={`panel-actions ${hstack({ gap: 'xs', flexShrink: 0 })}`}>
					<button
						type="button"
						class={styles.iconButton}
						disabled={working !== null}
						aria-label="Cancel renaming {name}"
						onclick={cancel}><X size={16} aria-hidden="true" /></button
					>
					<button
						type="submit"
						class={cx(styles.iconButton, css({ color: 'scrapscache.success' }))}
						disabled={locked || !draft.trim()}
						aria-label="Save name"><Check size={16} aria-hidden="true" /></button
					>
				</div>
			</form>
		{:else}
			<button
				type="button"
				class={styles.select}
				disabled={locked}
				aria-label={active ? `${name} is active` : `Switch to ${name}`}
				onpointerdown={down}
				onclick={() => {
					if (swiped) {
						swiped = false;
						return;
					}
					if (swipeOpen) settle(false);
					else onselect();
				}}
			>
				<span class={styles.glyph} aria-hidden="true">{@render icon()}</span>
				<span class={styles.content}>
					<span class={cx(css({ display: 'block' }), truncate)}>{name}</span>
					<span class={styles.caption}>{caption}</span>
				</span>
			</button>
			<div class={`tools ${hstack({ gap: '3xs', flexShrink: 0 })}`} hidden={swipeOpen}>
				<button
					type="button"
					class={styles.iconButton}
					disabled={locked}
					title="Export notes"
					aria-label="Export {name}"
					onclick={(event) => {
						event.stopPropagation();
						onexport();
					}}><Download size={16} aria-hidden="true" /></button
				>
				<button
					type="button"
					class={styles.iconButton}
					disabled={locked}
					title={expanded ? 'Hide workspace options' : 'Show workspace options'}
					aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
					aria-expanded={expanded}
					onclick={(event) => {
						event.stopPropagation();
						onexpand();
					}}
				>
					<span class={chevronClass}><ChevronDown size={16} aria-hidden="true" /></span>
				</button>
			</div>
		{/if}
	</div>

	<div class={styles.menu} hidden={!expanded || mode !== 'idle'}>
		{#if onrename}
			<button
				type="button"
				class={styles.manageRow}
				disabled={locked}
				onclick={startRename}
				aria-label="Rename {name}"
			>
				<Pencil size={16} aria-hidden="true" /><span
					>Rename<small>Change this workspace’s name</small></span
				>
			</button>
		{/if}
		{@render actions?.()}
		{#if onunlink}
			<button
				type="button"
				class={cx(styles.manageRow, styles.manageRowDanger)}
				disabled={locked}
				onclick={askUnlink}
				aria-label="Unlink {name}"
			>
				<CloudOff size={16} aria-hidden="true" /><span
					>Unlink<small>Stop syncing on this device. Notes stay here.</small></span
				>
			</button>
		{/if}
		{@render danger?.()}
	</div>
</div>
