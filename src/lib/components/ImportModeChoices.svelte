<script lang="ts">
	import { ChevronRight, CopyPlus, Replace } from '@lucide/svelte';
	import { BackupImportMode } from '$lib/backup';

	let {
		busy = false,
		keepImport = false,
		keepButton = $bindable(null),
		onSelect
	}: {
		busy?: boolean;
		keepImport?: boolean;
		keepButton?: HTMLButtonElement | null;
		onSelect: (mode: BackupImportMode) => void | Promise<void>;
	} = $props();
</script>

<div class="choices">
	<button
		bind:this={keepButton}
		type="button"
		class="choice"
		disabled={busy}
		onclick={() => onSelect(BackupImportMode.Keep)}
	>
		<span class="icon" aria-hidden="true"><CopyPlus size={18} /></span>
		<span class="body">
			<span class="title">Keep local notes <span class="badge">Recommended</span></span>
			<span class="caption">
				{keepImport
					? 'Add every Keep note as a new copy. Existing notes stay unchanged.'
					: 'Add every backup note as a new copy. Existing notes stay unchanged.'}
			</span>
		</span>
		<ChevronRight size={18} class="arrow" aria-hidden="true" />
	</button>
	<button
		type="button"
		class="choice danger"
		disabled={busy}
		onclick={() => onSelect(BackupImportMode.Replace)}
	>
		<span class="icon" aria-hidden="true"><Replace size={18} /></span>
		<span class="body">
			<span class="title">Replace local data</span>
			<span class="caption">
				{keepImport
					? 'Delete current notes in this workspace and import Keep instead.'
					: 'Delete current local notes and restore the backup instead.'}
			</span>
		</span>
		<ChevronRight size={18} class="arrow" aria-hidden="true" />
	</button>
</div>

<style>
	.choices {
		display: grid;
		gap: 10px;
	}
	.choice {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 14px;
		border: 1px solid var(--scrapscache-border);
		border-radius: 12px;
		background: var(--scrapscache-bg);
		color: var(--scrapscache-text);
		text-align: left;
		cursor: pointer;
		transition:
			border-color 120ms ease,
			background-color 120ms ease;
		touch-action: manipulation;
	}
	.choice:hover:not(:disabled) {
		border-color: var(--scrapscache-accent);
		background: color-mix(in srgb, var(--scrapscache-accent) 7%, var(--scrapscache-bg));
	}
	.choice.danger:hover:not(:disabled) {
		border-color: var(--scrapscache-danger);
		background: color-mix(in srgb, var(--scrapscache-danger) 7%, var(--scrapscache-bg));
	}
	.choice:focus-visible {
		outline: 2px solid var(--scrapscache-focus, var(--scrapscache-accent));
		outline-offset: 2px;
	}
	.choice:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.icon {
		display: grid;
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		place-items: center;
		border-radius: 10px;
		background: color-mix(in srgb, var(--scrapscache-accent) 15%, transparent);
		color: var(--scrapscache-accent);
	}
	.danger .icon {
		background: var(--scrapscache-danger-subtle);
		color: var(--scrapscache-danger);
	}
	.body {
		min-width: 0;
		flex: 1;
	}
	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		font-weight: 500;
	}
	.danger .title {
		color: var(--scrapscache-danger);
	}
	.badge {
		padding: 1px 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--scrapscache-accent) 15%, transparent);
		color: var(--scrapscache-accent);
		font-size: 11px;
		font-weight: 500;
	}
	.caption {
		display: block;
		margin-top: 3px;
		color: var(--scrapscache-text-muted);
		font-size: 12px;
		line-height: 1.45;
	}
	.choice :global(.arrow) {
		flex-shrink: 0;
		color: var(--scrapscache-text-muted);
		transition: transform 120ms ease;
	}
	.choice:hover:not(:disabled) :global(.arrow) {
		transform: translateX(2px);
		color: var(--scrapscache-text);
	}
</style>
