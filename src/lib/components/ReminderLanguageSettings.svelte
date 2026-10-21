<script lang="ts">
	import { settingsMenuStyles as styles } from '$panda/styles';
	import { Menu } from '@ark-ui/svelte/menu';
	import { Check, ChevronDown, Languages } from '@lucide/svelte';
	import { REMINDER_LANGUAGES } from '#lib/reminderPhrase.js';
	import { uiStore } from '#lib/stores/ui.svelte.js';
	import { cx } from 'styled-system/css';
	import { menuItem } from 'styled-system/recipes';

	let expanded = $state(false);
	const id = $props.id();
	const labelId = `${id}-label`;
	const statusId = `${id}-status`;
	const listId = `${id}-list`;
	const names = $derived(
		uiStore.reminderLanguages
			.map((code) => REMINDER_LANGUAGES.find((language) => language.code === code)?.name)
			.join(', ')
	);
	const itemClass = cx(menuItem({ density: 'compact' }), styles.row, styles.languageItem);
</script>

<Menu.Item
	value="reminder-languages"
	closeOnSelect={false}
	onSelect={() => (expanded = !expanded)}
	class={cx(menuItem({ density: 'compact' }), styles.deviceRow)}
	aria-labelledby={labelId}
	aria-describedby={statusId}
	aria-expanded={expanded}
	aria-controls={expanded ? listId : undefined}
>
	<Languages class={styles.deviceIcon} aria-hidden="true" />
	<span class={styles.deviceText}>
		<span id={labelId} class={styles.deviceLabel}>Reminder languages</span>
		<span id={statusId} class={styles.status}>Typed times are read in {names}.</span>
	</span>
	<ChevronDown
		class={cx(styles.deviceChevron, expanded ? styles.chevronOpen : undefined)}
		aria-hidden="true"
	/>
</Menu.Item>
{#if expanded}
	<div id={listId} role="group" aria-labelledby={labelId}>
		{#each REMINDER_LANGUAGES as language (language.code)}
			{@const checked = uiStore.reminderLanguages.includes(language.code)}
			<Menu.CheckboxItem
				value={`reminder-language-${language.code}`}
				{checked}
				disabled={checked && uiStore.reminderLanguages.length === 1}
				closeOnSelect={false}
				onCheckedChange={() => uiStore.toggleReminderLanguage(language.code)}
				class={itemClass}
			>
				<span class={styles.languageCheck}>
					<Menu.ItemIndicator><Check size={14} aria-hidden="true" /></Menu.ItemIndicator>
				</span>
				<Menu.ItemText lang={language.code}>{language.name}</Menu.ItemText>
			</Menu.CheckboxItem>
		{/each}
	</div>
{/if}
