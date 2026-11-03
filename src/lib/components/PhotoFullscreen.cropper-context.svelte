<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { UseImageCropperContext } from '@ark-ui/svelte/image-cropper';
	import { cropperHarness } from './PhotoFullscreen.cropperMock.js';

	let { render }: { render: Snippet<[UseImageCropperContext]> } = $props();
	const context = (() => cropperHarness) as unknown as UseImageCropperContext;
</script>

{@render render(context)}
