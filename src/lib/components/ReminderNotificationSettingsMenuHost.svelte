<script lang="ts">
	// Host for tests: Menu.Item components need a Menu context to exist in, and
	// their selection only registers while the menu is open.
	import { Menu } from '@ark-ui/svelte/menu';
	import ReminderNotificationSettings from './ReminderNotificationSettings.svelte';
</script>

<Menu.Root>
	<Menu.Trigger>Open settings menu</Menu.Trigger>
	<Menu.Positioner>
		<Menu.Content>
			<ReminderNotificationSettings />
		</Menu.Content>
	</Menu.Positioner>
</Menu.Root>
