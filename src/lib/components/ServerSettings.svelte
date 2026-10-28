<script lang="ts">
	// The iPhone app's server: where it syncs. The web app has no such row.
	import { settingsMenuStyles as styles } from '$panda/styles';
	import { Menu } from '@ark-ui/svelte/menu';
	import { ChevronDown, Server } from '@lucide/svelte';
	import { DEFAULT_SERVER_ORIGIN, serverSetting } from '#lib/serverOrigin.svelte.js';
	import { cx } from 'styled-system/css';
	import { input, menuItem } from 'styled-system/recipes';

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

	function save() {
		rejected = !serverSetting.set(draft || DEFAULT_SERVER_ORIGIN);
		if (!rejected) expanded = false;
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
			>Syncs with {host}{serverSetting.isDefault ? '' : ' (self-hosted)'}.</span
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
		/>
		<button type="submit" class={styles.serverSave}>Use</button>
	</form>
	{#if rejected}
		<p class={styles.serverAlert} role="alert">
			Enter an https address, such as {DEFAULT_SERVER_ORIGIN}.
		</p>
	{/if}
{/if}
