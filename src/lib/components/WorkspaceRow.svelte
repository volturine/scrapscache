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

	let mode = $state<'idle' | 'rename' | 'confirm'>('idle');
	let working = $state<'rename' | 'unlink' | null>(null);
	let draft = $state('');
	let rowElement: HTMLDivElement | undefined;
	let renameInput: HTMLInputElement | undefined;
	let trigger: HTMLElement | null = null;

	const locked = $derived(disabled || working !== null);
	const nameFieldClass = $derived(
		cx(inputRecipe({ variant: 'outline', size: 'sm' }), css({ w: 'full', font: 'inherit' }))
	);
	const chevronClass = $derived(cx(styles.chevron, expanded && styles.chevronOpen));

	function notifyBusy() {
		onbusychange(mode !== 'idle');
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

	function startRename(event: MouseEvent) {
		if (!onrename) return;
		trigger = event.currentTarget as HTMLElement;
		draft = name;
		setMode('rename');
	}

	function askUnlink(event?: MouseEvent) {
		if (!onunlink) return;
		trigger = (event?.currentTarget as HTMLElement | undefined) ?? null;
		setMode('confirm');
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
		if (mode === 'rename') void saveRename();
		else if (mode === 'confirm') cancel();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || (mode === 'idle' && !expanded)) return;
		event.preventDefault();
		if (mode !== 'idle') cancel();
		else onexpand();
	}
</script>

<svelte:document onkeydown={onKeyDown} onpointerdown={onDocumentPointerDown} />

<div
	bind:this={rowElement}
	class={`row ${styles.row}`}
	class:editing={mode !== 'idle'}
	tabindex="-1"
>
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
				onclick={onselect}
			>
				<span class={styles.glyph} aria-hidden="true">{@render icon()}</span>
				<span class={styles.content}>
					<span class={cx(css({ display: 'block' }), truncate)}>{name}</span>
					<span class={styles.caption}>{caption}</span>
				</span>
			</button>
		{/if}
		<div class={`tools ${hstack({ gap: '3xs', flexShrink: 0 })}`} hidden={mode !== 'idle'}>
			{#if onrename}
				<button
					type="button"
					class={styles.iconButton}
					disabled={locked}
					title="Rename"
					aria-label="Rename {name}"
					onclick={startRename}><Pencil size={16} aria-hidden="true" /></button
				>
			{/if}
			{#if onunlink}
				<button
					type="button"
					class={styles.iconButton}
					disabled={locked}
					title="Unlink"
					aria-label="Unlink {name}"
					onclick={askUnlink}><CloudOff size={16} aria-hidden="true" /></button
				>
			{/if}
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
	</div>

	<div class={styles.menu} hidden={!expanded || mode !== 'idle'}>
		{@render actions?.()}
		{@render danger?.()}
	</div>
</div>
