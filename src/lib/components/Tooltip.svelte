<script lang="ts">
	import { Tooltip } from '@ark-ui/svelte/tooltip';
	import type { Snippet } from 'svelte';
	import { portalToAppOverlay } from '$lib/appViewport';
	import type { Placement } from '@zag-js/tooltip';
	import { sva } from 'styled-system/css';
	import { tooltip } from 'styled-system/recipes';

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

	const styles = sva({
		slots: ['trigger'],
		base: { trigger: { display: 'inline-flex' } }
	})();
</script>

{#if content}
	<Tooltip.Root {openDelay} {closeDelay} positioning={{ placement, gutter: 6 }}>
		<Tooltip.Trigger>
			{#snippet asChild(triggerProps)}
				<span {...triggerProps()} class={[styles.trigger, className]}>
					{@render children()}
				</span>
			{/snippet}
		</Tooltip.Trigger>
		<div {@attach portalToAppOverlay}>
			<Tooltip.Positioner>
				<Tooltip.Content class={tooltip()}>
					{content}
				</Tooltip.Content>
			</Tooltip.Positioner>
		</div>
	</Tooltip.Root>
{:else}
	{@render children()}
{/if}
