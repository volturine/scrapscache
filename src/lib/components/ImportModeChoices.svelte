<script lang="ts">
	import { CopyPlus, Replace } from '@lucide/svelte';
	import { BackupImportMode } from '$lib/backup';
	import ChoiceCard from './ChoiceCard.svelte';

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

<div class="grid gap-2.5">
	<ChoiceCard
		bind:element={keepButton}
		title="Keep local notes"
		badge="Recommended"
		caption={keepImport
			? 'Add every Keep note as a new copy. Existing notes stay unchanged.'
			: 'Add every backup note as a new copy. Existing notes stay unchanged.'}
		disabled={busy}
		onclick={() => onSelect(BackupImportMode.Keep)}
	>
		{#snippet icon()}<CopyPlus size={18} />{/snippet}
	</ChoiceCard>
	<ChoiceCard
		title="Replace local data"
		caption={keepImport
			? 'Delete current notes in this workspace and import Keep instead.'
			: 'Delete current local notes and restore the backup instead.'}
		danger
		disabled={busy}
		onclick={() => onSelect(BackupImportMode.Replace)}
	>
		{#snippet icon()}<Replace size={18} />{/snippet}
	</ChoiceCard>
</div>
