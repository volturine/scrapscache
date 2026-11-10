<script lang="ts">
	// The iPhone app's server: where it syncs. The web app has no such row.
	import { settingsMenuStyles as styles } from '$panda/styles';
	import { Menu, useMenuContext } from '@ark-ui/svelte/menu';
	import { ChevronDown, Server } from '@lucide/svelte';
	import { DEFAULT_SERVER_ORIGIN, serverSetting } from '#lib/serverOrigin.svelte.js';
	import { syncStore } from '#lib/stores/sync.svelte.js';
	import { cx } from 'styled-system/css';
	import { input, menuItem } from 'styled-system/recipes';

	const menuApi = useMenuContext();
	let expanded = $state(false);
	let draft = $state('');
	let rejected = $state(false);
	const id = $props.id();
	const labelId = `${id}-label`;
	const statusId = `${id}-status`;
	const fieldId = `${id}-field`;
	const host = $derived(new URL(serverSetting.origin).host);

	function toggle() {
		expanded = !expanded;
		if (expanded) {
			draft = serverSetting.origin;
			rejected = false;
		}
	}

	/**
	 * Keeps the focused field in sight in the menu, which scrolls. The keys come up
	 * after the focus, and they change only the visual viewport: the menu measures
	 * its room on a window resize, which they do not cause, so it is told to, and
	 * the field is held inside what is left above them.
	 */
	function keepInSight(field: HTMLInputElement) {
		const menu = field.closest<HTMLElement>('[role="menu"]');
		if (!menu) return;
		const viewport = window.visualViewport;
		const reveal = () => {
			if (document.activeElement !== field) return;
			const box = field.getBoundingClientRect();
			const room = menu.getBoundingClientRect();
			const top = viewport ? Math.max(room.top, viewport.offsetTop) : room.top;
			const bottom = viewport
				? Math.min(room.bottom, viewport.offsetTop + viewport.height)
				: room.bottom;
			if (box.bottom > bottom) menu.scrollTop += box.bottom - bottom;
			else if (box.top < top) menu.scrollTop -= top - box.top;
		};
		const refit = () => {
			if (document.activeElement !== field) return;
			menuApi().reposition();
			requestAnimationFrame(reveal);
		};
		const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
		resize?.observe(menu);
		field.addEventListener('focus', reveal);
		viewport?.addEventListener('resize', refit);
		viewport?.addEventListener('scroll', refit);
		return () => {
			resize?.disconnect();
			field.removeEventListener('focus', reveal);
			viewport?.removeEventListener('resize', refit);
			viewport?.removeEventListener('scroll', refit);
		};
	}

	function save() {
		const previous = serverSetting.origin;
		rejected = !serverSetting.set(draft || DEFAULT_SERVER_ORIGIN);
		if (rejected) return;
		expanded = false;
		if (serverSetting.origin !== previous) syncStore.serverChanged();
	}
</script>

<Menu.Item
	value="server"
	closeOnSelect={false}
	onSelect={toggle}
	class={cx(menuItem({ density: 'compact' }), styles.deviceRow)}
	aria-labelledby={labelId}
	aria-describedby={statusId}
	aria-expanded={expanded}
	aria-controls={expanded ? fieldId : undefined}
>
	<Server class={styles.deviceIcon} aria-hidden="true" />
	<span class={styles.deviceText}>
		<span id={labelId} class={styles.deviceLabel}>Server</span>
		<span id={statusId} class={styles.status}
			>Syncs with {host}{serverSetting.isDefault ? '' : ' (self-hosted)'}</span
		>
	</span>
	<ChevronDown
		class={cx(styles.deviceChevron, expanded ? styles.chevronOpen : undefined)}
		aria-hidden="true"
	/>
</Menu.Item>
{#if expanded}
	<form
		class={styles.serverForm}
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<!-- Keys typed here are for the field, not the menu's navigation. -->
		<input
			id={fieldId}
			class={cx(input(), styles.serverField)}
			onkeydown={(event) => event.stopPropagation()}
			type="url"
			inputmode="url"
			autocapitalize="off"
			autocomplete="off"
			spellcheck="false"
			placeholder={DEFAULT_SERVER_ORIGIN}
			aria-label="Server address"
			aria-invalid={rejected || undefined}
			bind:value={draft}
			{@attach keepInSight}
		/>
		<button type="submit" class={styles.serverSave}>Use</button>
	</form>
	{#if rejected}
		<p class={styles.serverAlert} role="alert">
			Enter an https address, such as {DEFAULT_SERVER_ORIGIN}.
		</p>
	{/if}
{/if}
