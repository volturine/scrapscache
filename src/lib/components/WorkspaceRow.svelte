<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Check, CloudOff, Pencil, TriangleAlert, X } from '@lucide/svelte';

	let {
		name,
		caption,
		active,
		disabled,
		icon,
		onselect,
		onrename,
		onunlink,
		onbusychange
	}: {
		name: string;
		caption: string;
		active: boolean;
		disabled: boolean;
		icon: Snippet;
		onselect: () => void;
		onrename: (next: string) => Promise<boolean>;
		onunlink: () => Promise<boolean>;
		onbusychange: (holdsEscape: boolean) => void;
	} = $props();

	// Width of the swipe drawer: two touch targets side by side.
	const ACTIONS_WIDTH = 152;
	// Share of the row a swipe must cross to arm the full-swipe unlink.
	const COMMIT_RATIO = 0.55;
	// Past the drawer the row keeps moving, but slower than the finger.
	const OVERSWIPE_RESISTANCE = 0.7;
	const RUBBER_BAND = 0.25;
	// Pixels per millisecond that count as a flick rather than a drag.
	const FLICK_VELOCITY = 0.4;
	// Horizontal travel that turns a touch into a swipe.
	const SLOP = 8;

	let mode = $state<'idle' | 'rename' | 'confirm'>('idle');
	let working = $state<'rename' | 'unlink' | null>(null);
	let draft = $state('');
	let open = $state(false);
	let offset = $state(0);
	let dragging = $state(false);
	let armed = $state(false);
	let rowElement: HTMLDivElement | undefined;
	let input: HTMLInputElement | undefined;
	// The control a panel was opened from, so focus can go back where it started.
	let trigger: HTMLElement | null = null;
	let start: { x: number; y: number; offset: number } | null = null;
	let last = { x: 0, time: 0 };
	let velocity = 0;
	let swiped = false;

	const progress = $derived(Math.min(1, Math.max(0, -offset / ACTIONS_WIDTH)));
	const locked = $derived(disabled || working !== null);

	// While a row edits or shows its drawer, Escape belongs to the row. The
	// dialog must stop closing on it, which only the dialog itself can decide.
	// Announced from the two writers below rather than watched, so the parent
	// hears a change only when one actually happens.
	function notifyBusy() {
		onbusychange(mode !== 'idle' || open);
	}

	function setMode(next: typeof mode) {
		mode = next;
		notifyBusy();
	}

	// A panel only exists while it is open, so mounting it is the moment to take
	// focus, and unmounting is the moment to hand it back. The browser drops
	// focus on the body when the element holding it goes away, which strands
	// keyboard users at the top of the sheet.
	function takeFocus(node: HTMLElement) {
		node.focus();
		return () => {
			// Reclaim only what the panel itself was still holding. A click
			// elsewhere has already chosen where focus belongs, and that wins.
			const active = document.activeElement;
			if (active === node || active === document.body || active === null) trigger?.focus();
		};
	}

	// Held beyond mount so a rejected rename can hand focus back to the field.
	function renameField(node: HTMLInputElement) {
		input = node;
		const release = takeFocus(node);
		node.select();
		return () => {
			if (input === node) input = undefined;
			release();
		};
	}

	// Never arm before the drawer is fully uncovered, whatever the row measures.
	function commitDistance(): number {
		return Math.max(ACTIONS_WIDTH + 40, (rowElement?.clientWidth ?? 0) * COMMIT_RATIO);
	}

	function settle(next: boolean) {
		open = next;
		offset = next ? -ACTIONS_WIDTH : 0;
		notifyBusy();
	}

	// The gesture belongs to the row it started on. Everything after the press is
	// tracked on the document, so the drag survives the finger wandering onto a
	// neighbouring row or off the list entirely.
	function down(event: PointerEvent) {
		if (locked || mode !== 'idle' || event.pointerType !== 'touch') return;
		start = { x: event.clientX, y: event.clientY, offset: open ? -ACTIONS_WIDTH : 0 };
		last = { x: event.clientX, time: event.timeStamp };
		velocity = 0;
		swiped = false;
	}

	function move(event: PointerEvent) {
		if (!start) return;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (!dragging) {
			// Wait for a clear sideways pull rather than giving up on the gesture:
			// a swipe that drifts down first still counts once it turns left. The
			// browser cancels this pointer if it decides the list should scroll.
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
		settle(open);
	}

	function startRename(event: MouseEvent) {
		trigger = event.currentTarget as HTMLElement;
		draft = name;
		setMode('rename');
		settle(false);
	}

	// Opened by the tile, or by a full swipe, which has no control to return to.
	function askUnlink(event?: MouseEvent) {
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
		if (!next || next === name) {
			cancel();
			return;
		}
		working = 'rename';
		const saved = await onrename(next);
		working = null;
		if (saved) setMode('idle');
		else input?.focus();
	}

	async function confirmUnlink() {
		working = 'unlink';
		const done = await onunlink();
		working = null;
		if (done) setMode('idle');
	}

	function onDocumentPointerDown(event: PointerEvent) {
		if (working || !rowElement || rowElement.contains(event.target as Node)) return;
		if (open) settle(false);
		// Clicking away keeps a typed name, the way a file rename behaves.
		if (mode === 'rename') void saveRename();
		else if (mode === 'confirm') cancel();
	}

	// Escape belongs to the row while it is editing or open. Tracked on the
	// document, like the drag handlers below, because the row loses focus the
	// moment a panel replaces the button that opened it. The dialog is kept open
	// by the busy state the row reports, not by stopping the event here.
	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || (mode === 'idle' && !open)) return;
		event.preventDefault();
		if (mode === 'idle') settle(false);
		else cancel();
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
	class="row"
	class:open
	class:armed
	class:dragging
	class:editing={mode !== 'idle'}
	style:--swipe-offset={`${offset}px`}
	style:--swipe-progress={progress}
>
	<div class="actions">
		<button
			type="button"
			class="tile"
			disabled={locked}
			title="Rename"
			aria-label="Rename {name}"
			onclick={startRename}
		>
			<Pencil size={16} aria-hidden="true" /><span class="tile-label">Rename</span>
		</button>
		<button
			type="button"
			class="tile unlink"
			disabled={locked}
			title="Unlink"
			aria-label="Unlink {name}"
			onclick={askUnlink}
		>
			<CloudOff size={16} aria-hidden="true" /><span class="tile-label"
				>{armed ? 'Release' : 'Unlink'}</span
			>
		</button>
	</div>

	<div class="front" class:active>
		{#if mode === 'confirm'}
			<div class="panel confirm">
				<span class="glyph" aria-hidden="true"><TriangleAlert size={18} /></span>
				<p class="message">
					Unlink <strong>{name}</strong>?<span class="caption"
						>Its notes move to Anonymous workspace. Cloud data stays.</span
					>
				</p>
				<div class="panel-actions">
					<button
						type="button"
						class="ghost"
						{@attach takeFocus}
						disabled={working !== null}
						aria-label="Keep {name} linked"
						onclick={cancel}>Cancel</button
					>
					<button
						type="button"
						class="danger"
						disabled={locked}
						aria-label="Unlink {name} and keep notes"
						onclick={() => void confirmUnlink()}
						>{working === 'unlink' ? 'Unlinking…' : 'Unlink'}</button
					>
				</div>
			</div>
		{:else if mode === 'rename'}
			<form
				class="panel"
				onsubmit={(event) => {
					event.preventDefault();
					void saveRename();
				}}
			>
				<span class="glyph" aria-hidden="true">{@render icon()}</span>
				<span class="body">
					<input
						{@attach renameField}
						bind:value={draft}
						class="name-input"
						maxlength="60"
						spellcheck="false"
						disabled={working !== null}
						aria-label="Workspace name"
					/>
					<span class="caption">
						{#if working === 'rename'}Saving…{:else}<span class="on-wide"
								>Enter saves · Esc cancels</span
							><span class="on-narrow">{caption}</span>{/if}
					</span>
				</span>
				<div class="panel-actions">
					<button
						type="button"
						class="icon"
						disabled={working !== null}
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
		{:else}
			<button
				type="button"
				class="select"
				disabled={locked}
				aria-label={active ? `${name} is active` : `Switch to ${name}`}
				onpointerdown={down}
				onclick={() => {
					if (swiped) {
						swiped = false;
						return;
					}
					if (open) settle(false);
					else onselect();
				}}
			>
				<span class="glyph" aria-hidden="true">{@render icon()}</span>
				<span class="body">
					<span class="name">{name}</span>
					<span class="caption">{caption}</span>
				</span>
			</button>
		{/if}
	</div>
</div>

<style>
	.row {
		position: relative;
		border-radius: 10px;
	}
	.front {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: stretch;
		border-radius: 10px;
		background: var(--scrapscache-surface, var(--scrapscache-bg));
	}
	.front.active,
	.row.editing .front {
		background: var(--scrapscache-interactive-hover);
	}
	/* The current workspace keeps a marker so hover never impersonates it. */
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
		.row:hover .front {
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
	.select {
		padding-right: 76px;
		touch-action: pan-y;
	}
	.glyph {
		display: grid;
		flex-shrink: 0;
		place-items: center;
		color: var(--scrapscache-text-muted);
	}
	.body,
	.message {
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
	.message {
		font-size: 13px;
	}
	.panel.confirm {
		background: var(--scrapscache-danger-subtle);
		border-radius: 10px;
	}
	.panel.confirm .glyph {
		color: var(--scrapscache-danger);
	}
	.panel-actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
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

	/* Desktop: the actions ride above the right edge and fade in on approach. */
	.actions {
		position: absolute;
		inset: 0 0 0 auto;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 8px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease;
	}
	.row:hover .actions,
	.row:focus-within .actions {
		opacity: 1;
		pointer-events: auto;
	}
	.row.editing .actions {
		display: none;
	}
	.tile {
		display: grid;
		width: 30px;
		height: 30px;
		place-items: center;
		border-radius: 7px;
		color: var(--scrapscache-text-muted);
	}
	.tile:hover {
		background: var(--scrapscache-interactive-hover);
		color: var(--scrapscache-text);
	}
	.tile.unlink:hover {
		color: var(--scrapscache-danger);
	}
	.tile-label,
	.on-narrow {
		display: none;
	}

	@media (max-width: 640px) {
		/* Phones: the row slides to uncover the actions underneath it. */
		.row {
			overflow: hidden;
		}
		.front {
			transform: translateX(var(--swipe-offset));
		}
		.row:not(.dragging) .front {
			transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
		}
		.row:not(.dragging):has(.actions :focus-visible) .front {
			transform: translateX(-152px);
		}
		/* The drawer is exactly as wide as the row has been pulled aside, and its
		   actions are pinned to the trailing edge, so Unlink leads the reveal. */
		.actions {
			z-index: 0;
			width: max(0px, calc(-1 * var(--swipe-offset)));
			justify-content: flex-end;
			padding-right: 0;
			overflow: hidden;
			border-radius: 0 10px 10px 0;
			opacity: 1;
			pointer-events: auto;
		}
		.row:not(.dragging) .actions {
			transition: width 260ms cubic-bezier(0.22, 1, 0.36, 1);
		}
		.tile {
			display: flex;
			width: 76px;
			height: auto;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 4px;
			flex-shrink: 0;
			align-self: stretch;
			border-radius: 0;
			font-size: 12px;
			color: var(--scrapscache-text);
		}
		.tile.unlink {
			flex: 1 0 76px;
			color: var(--scrapscache-danger);
		}
		.tile:hover {
			background: transparent;
		}
		.tile-label {
			display: block;
		}
		.on-wide {
			display: none;
		}
		.on-narrow {
			display: inline;
		}
		/* Icons settle to full size as the drawer arrives. */
		.tile > :global(svg) {
			transform: scale(calc(0.8 + 0.2 * var(--swipe-progress)));
		}
		.row.armed .tile.unlink {
			background: var(--scrapscache-danger);
			color: var(--scrapscache-danger-foreground);
		}
		.row.armed .tile:not(.unlink) {
			opacity: 0;
		}
		.select {
			padding-right: 12px;
		}
		.panel.confirm {
			flex-wrap: wrap;
		}
		.panel.confirm .panel-actions {
			width: 100%;
			justify-content: flex-end;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.row:not(.dragging) .front {
			transition: none;
		}
	}
	button:disabled {
		opacity: 0.55;
	}
</style>
