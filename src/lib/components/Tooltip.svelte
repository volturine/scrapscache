<script lang="ts">
	import { Tooltip } from '@ark-ui/svelte/tooltip';
	import type { Snippet } from 'svelte';
	import { portalToAppOverlay } from '$lib/appViewport';
	import type { Placement } from '@zag-js/tooltip';

	let {
		content,
		placement = 'bottom',
		openDelay = 500,
		closeDelay = 100,
		class: className = '',
		children
	}: {
		content: string;
		placement?: Placement;
		openDelay?: number;
		closeDelay?: number;
		class?: string;
		children: Snippet;
	} = $props();
</script>

{#if content}
	<Tooltip.Root {openDelay} {closeDelay} positioning={{ placement, gutter: 6 }}>
		<Tooltip.Trigger>
			{#snippet asChild(triggerProps)}
				<span {...triggerProps()} class="inline-flex {className}">
					{@render children()}
				</span>
			{/snippet}
		</Tooltip.Trigger>
		<div {@attach portalToAppOverlay}>
			<Tooltip.Positioner>
				<Tooltip.Content
					class="pointer-events-none z-[120] rounded-md bg-neutral-900/90 px-2 py-1 text-xs font-medium text-white shadow-md backdrop-blur-sm transition-opacity duration-150 dark:bg-neutral-100/90 dark:text-neutral-900"
				>
					{content}
				</Tooltip.Content>
			</Tooltip.Positioner>
		</div>
	</Tooltip.Root>
{:else}
	{@render children()}
{/if}
