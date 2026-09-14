<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Check, ChevronDown, CloudOff, Download, Pencil, TriangleAlert, X } from '@lucide/svelte';

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

	let mode = $state<'idle' | 'rename' | 'confirm'>('idle');
	let working = $state(false);
	let draft = $state('');
	let rowElement: HTMLDivElement | undefined;
	let input: HTMLInputElement | undefined;
	let trigger: HTMLElement | null = null;

	const locked = $derived(disabled || working);

	function notifyBusy() {
		onbusychange(mode !== 'idle');
	}

	function panelHoldsFocus() {
		const activeEl = document.activeElement;
		if (activeEl === rowElement || activeEl === document.body || activeEl === null) return true;
		return mode !== 'idle' && !!rowElement?.contains(activeEl);
	}

	function leavePanel(restore: boolean) {
		if (restore) rowElement?.focus({ preventScroll: true });
		mode = 'idle';
		draft = name;
		notifyBusy();
		if (restore) queueMicrotask(() => trigger?.focus());
	}

	function focusWhenMounted(node: HTMLElement) {
		node.focus();
	}

	function renameField(node: HTMLInputElement) {
		input = node;
		node.focus();
		node.select();
		return () => {
			if (input === node) input = undefined;
		};
	}

	function startRename(event: MouseEvent) {
		if (!onrename) return;
		trigger = event.currentTarget as HTMLElement;
		draft = name;
		mode = 'rename';
		notifyBusy();
	}

	function askUnlink(event: MouseEvent) {
		if (!onunlink) return;
		trigger = event.currentTarget as HTMLElement;
		mode = 'confirm';
		notifyBusy();
	}

	async function confirmUnlink() {
		if (!onunlink) return;
		working = true;
		const done = await onunlink();
		working = false;
		if (done) leavePanel(true);
	}

	function cancel() {
		leavePanel(panelHoldsFocus());
	}

	async function saveRename() {
		const next = draft.trim();
		if (!onrename || !next || next === name) {
			cancel();
			return;
		}
		working = true;
		const saved = await onrename(next);
		working = false;
		if (saved) leavePanel(true);
		else input?.focus();
	}

	function onDocumentPointerDown(event: PointerEvent) {
		if (working || !rowElement || rowElement.contains(event.target as Node)) return;
		if (mode === 'rename') void saveRename();
		else if (mode === 'confirm') cancel();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		if (mode !== 'idle') {
			event.preventDefault();
			event.stopPropagation();
			cancel();
			return;
		}
		if (expanded) {
			event.preventDefault();
			event.stopPropagation();
			onexpand();
		}
	}
</script>

<svelte:document onkeydown={onKeyDown} onpointerdown={onDocumentPointerDown} />

<div
	bind:this={rowElement}
	class="row"
	class:active
	class:open={expanded}
	class:editing={mode !== 'idle'}
	tabindex="-1"
>
	<div class="front" class:active>
		{#if onunlink}
			<div class="panel confirm" hidden={mode !== 'confirm'}>
				<span class="glyph" aria-hidden="true"><TriangleAlert size={18} /></span>
				<p class="message">
					Unlink <strong>{name}</strong>?<span class="caption"
						>This device’s notes are deleted. Cloud notes stay.</span
					>
				</p>
				<div class="panel-actions">
					<button
						type="button"
						class="ghost"
						{@attach mode === 'confirm' && focusWhenMounted}
						disabled={working}
						aria-label="Keep {name} linked"
						onclick={cancel}>Cancel</button
					>
					<button
						type="button"
						class="danger"
						disabled={locked}
						aria-label="Unlink {name} from this device"
						onclick={() => void confirmUnlink()}>{working ? 'Unlinking…' : 'Unlink'}</button
					>
				</div>
			</div>
		{/if}
		{#if onrename}
			<form
				class="panel"
				hidden={mode !== 'rename'}
				onsubmit={(event) => {
					event.preventDefault();
					void saveRename();
				}}
			>
				<span class="glyph" aria-hidden="true">{@render icon()}</span>
				<span class="body">
					<input
						{@attach mode === 'rename' && renameField}
						bind:value={draft}
						class="name-input"
						maxlength="60"
						spellcheck="false"
						disabled={working}
						aria-label="Workspace name"
					/>
					<span class="caption">
						{#if working}Saving…{:else}Enter saves · Esc cancels{/if}
					</span>
				</span>
				<div class="panel-actions">
					<button
						type="button"
						class="icon"
						disabled={working}
						aria-label="Cancel renaming {name}"
						onclick={cancel}><X size={16} aria-hidden="true" /></button
					>
					<button
						type="submit"
						class="icon accept"
						disabled={locked || !draft.trim()}
						aria-label="Save name"><Check size={16} aria-hidden="true" /></button
					>
				</div>
			</form>
		{/if}
		<button
			type="button"
			class="select"
			hidden={mode !== 'idle'}
			disabled={locked}
			aria-label={active ? `${name} is active` : `Switch to ${name}`}
			onclick={onselect}
		>
			<span class="glyph" aria-hidden="true">{@render icon()}</span>
			<span class="body">
				<span class="name">{name}</span>
				<span class="caption">{caption}</span>
			</span>
		</button>
		<div class="tools" hidden={mode !== 'idle'}>
			<button
				type="button"
				class="icon"
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
				class="icon"
				disabled={locked}
				title={expanded ? 'Hide workspace options' : 'Show workspace options'}
				aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
				aria-expanded={expanded}
				onclick={(event) => {
					event.stopPropagation();
					onexpand();
				}}
				><span class={['chevron', expanded && 'open']}
					><ChevronDown size={16} aria-hidden="true" /></span
				></button
			>
		</div>
	</div>
	<div class="menu" hidden={!expanded || mode !== 'idle'}>
		{#if onrename}
			<button
				type="button"
				class="manage-row"
				disabled={locked}
				onclick={startRename}
				aria-label="Rename {name}"
				><Pencil size={16} aria-hidden="true" /><span
					>Rename<small>Change this workspace’s name</small></span
				></button
			>
		{/if}
		{@render actions?.()}
		{#if onunlink}
			<button
				type="button"
				class="manage-row danger-text"
				disabled={locked}
				onclick={askUnlink}
				aria-label="Unlink {name}"
				><CloudOff size={16} aria-hidden="true" /><span
					>Unlink<small>Delete this device’s notes. Cloud notes stay.</small></span
				></button
			>
		{/if}
		{@render danger?.()}
	</div>
</div>

<style>
	.row {
		position: relative;
		border-radius: 10px;
		outline: none;
	}
	.row.active,
	.row.open,
	.row.editing {
		background: var(--scrapscache-interactive-hover);
	}
	.row [hidden] {
		display: none;
	}
	.front {
		position: relative;
		display: flex;
		align-items: stretch;
	}
	.front.active::before {
		content: '';
		position: absolute;
		top: 10px;
		bottom: 10px;
		left: 0;
		width: 3px;
		border-radius: 0 3px 3px 0;
		background: var(--scrapscache-accent);
	}
	@media (hover: hover) {
		.row:hover {
			background: var(--scrapscache-interactive-hover);
		}
	}
	.select,
	.panel {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding: 12px;
		text-align: left;
		font-size: 14px;
	}
	.glyph {
		display: grid;
		flex-shrink: 0;
		place-items: center;
		color: var(--scrapscache-text-muted);
	}
	.body {
		min-width: 0;
		flex: 1;
	}
	.name {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.caption {
		display: block;
		margin-top: 2px;
		color: var(--scrapscache-text-muted);
		font-size: 12px;
		font-weight: 400;
	}
	.name-input {
		width: 100%;
		padding: 1px 0;
		border: 0;
		border-bottom: 1px solid var(--scrapscache-accent);
		background: transparent;
		color: inherit;
		font: inherit;
		outline: none;
	}
	.panel-actions,
	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}
	.tools {
		padding-right: 8px;
	}
	.icon {
		display: grid;
		width: 30px;
		height: 30px;
		place-items: center;
		border-radius: 7px;
		color: var(--scrapscache-text-muted);
	}
	.icon:hover {
		background: var(--scrapscache-interactive-hover);
		color: var(--scrapscache-text);
	}
	.icon.accept {
		color: var(--scrapscache-success);
	}
	.chevron {
		display: grid;
		transition: transform 160ms ease;
	}
	.chevron.open {
		transform: rotate(180deg);
	}
	.menu {
		display: grid;
		gap: 2px;
		padding: 4px 8px 8px;
	}
	.manage-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		border-radius: 8px;
		padding: 10px 8px;
		text-align: left;
		font-size: 14px;
	}
	.message {
		min-width: 0;
		flex: 1;
		font-size: 13px;
	}
	.panel.confirm {
		background: var(--scrapscache-danger-subtle);
		border-radius: 10px;
	}
	.panel.confirm .glyph {
		color: var(--scrapscache-danger);
	}
	.ghost,
	.danger {
		padding: 7px 12px;
		border-radius: 7px;
		font-size: 13px;
		white-space: nowrap;
	}
	.ghost:hover {
		background: var(--scrapscache-interactive-hover);
	}
	.danger {
		background: var(--scrapscache-danger);
		color: var(--scrapscache-danger-foreground);
		font-weight: 500;
	}
	.manage-row:hover {
		background: color-mix(in srgb, var(--scrapscache-text) 6%, transparent);
	}
	.manage-row small {
		display: block;
		margin-top: 2px;
		color: var(--scrapscache-text-muted);
		font-size: 12px;
		font-weight: 400;
	}
	.danger-text {
		color: var(--scrapscache-danger);
	}
	button:disabled {
		opacity: 0.55;
	}
</style>
