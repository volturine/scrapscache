import { expect, test } from '@playwright/test';
import { createNote, noteCard, openEmptyApp, quickAction } from './app';
import type { Locator } from '@playwright/test';

/** Move a card to another column from its "…" menu. */
async function moveTo(card: Locator, column: string): Promise<void> {
	await card.getByRole('button', { name: 'Note actions' }).click();
	await card
		.page()
		.getByRole('menu', { name: 'Note actions' })
		.getByRole('menuitemradio', { name: column, exact: true })
		.click();
}

test('a label tags a note and filters the feed', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Tagged note');
	await createNote(page, 'Plain note');

	await quickAction(noteCard(page, 'Tagged note'), 'Add label…');
	const labels = page.getByRole('dialog').filter({ hasText: 'Labels' });
	await labels.getByPlaceholder('Search or create a label…').fill('Work');
	await labels.getByRole('button', { name: 'Create label' }).click();
	await expect(labels.getByRole('checkbox', { name: 'Work' })).toBeChecked();
	await labels.getByRole('button', { name: 'Done' }).click();

	await expect(noteCard(page, 'Tagged note')).toContainText('Work');

	await page
		.getByRole('region', { name: 'Labels' })
		.getByRole('button', { name: 'Work', exact: true })
		.click();
	await expect(page).toHaveURL(/\/label\//);
	await expect(page.getByRole('heading', { level: 1, name: 'Work' })).toBeVisible();
	await expect(noteCard(page, 'Tagged note')).toBeVisible();
	await expect(noteCard(page, 'Plain note')).toBeHidden();
});

test('a kanban board gains a label column that holds the tagged note', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Board card');
	await quickAction(noteCard(page, 'Board card'), 'Add label…');
	const labels = page.getByRole('dialog').filter({ hasText: 'Labels' });
	await labels.getByPlaceholder('Search or create a label…').fill('Doing');
	await labels.getByRole('button', { name: 'Create label' }).click();
	await labels.getByRole('button', { name: 'Done' }).click();

	await page.goto('/kanban');
	await expect(page.getByRole('button', { name: /^Board: Untitled board/ })).toBeVisible();
	await expect(page.locator('[data-kanban-column]')).toHaveCount(1);

	await page.getByRole('button', { name: 'Add a label column' }).click();
	await page
		.getByRole('menu', { name: 'Add a label column' })
		.getByRole('menuitem', { name: 'Doing' })
		.click();
	const column = page.locator('[data-kanban-column]', { hasText: 'Doing' });
	await expect(column).toBeVisible();
	await expect(column.getByRole('button', { name: 'Open Board card' })).toBeVisible();

	await page.getByRole('button', { name: /^Board: / }).click();
	await page.getByRole('menuitem', { name: 'New board' }).click();
	await page.getByRole('textbox', { name: 'Board name' }).fill('Launch');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Board: Launch' })).toBeVisible();
	await expect(page.locator('[data-kanban-column]')).toHaveCount(1);
});

test('moving a card to another column says where it went and can be undone', async ({ page }) => {
	await openEmptyApp(page);
	await createNote(page, 'Moving card');
	await quickAction(noteCard(page, 'Moving card'), 'Add label…');
	const labels = page.getByRole('dialog').filter({ hasText: 'Labels' });
	for (const name of ['Todo', 'Doing']) {
		await labels.getByPlaceholder('Search or create a label…').fill(name);
		await labels.getByRole('button', { name: 'Create label' }).click();
	}
	// Creating a label here also tags the note, which starts in Todo only.
	await labels.getByText('Doing', { exact: true }).click();
	await expect(labels.getByRole('checkbox', { name: 'Doing' })).not.toBeChecked();
	await labels.getByRole('button', { name: 'Done' }).click();

	await page.goto('/kanban');
	for (const name of ['Todo', 'Doing']) {
		await page.getByRole('button', { name: 'Add a label column' }).click();
		await page
			.getByRole('menu', { name: 'Add a label column' })
			.getByRole('menuitem', { name })
			.click();
	}
	const todo = page.getByRole('region', { name: 'Todo label column' });
	const doing = page.getByRole('region', { name: 'Doing label column' });
	const card = todo.getByRole('button', { name: 'Open Moving card' });
	await expect(card).toBeVisible();

	const from = (await card.boundingBox())!;
	const to = (await doing.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 120), { steps: 12 });
	await page.mouse.up();

	await expect(page.getByRole('status')).toContainText('Moved to Doing');
	await expect(doing.getByRole('button', { name: 'Open Moving card' })).toBeVisible();

	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(todo.getByRole('button', { name: 'Open Moving card' })).toBeVisible();
	await expect(doing.getByRole('button', { name: 'Open Moving card' })).toBeHidden();
});

test('a label is created from the + in the sidebar, not from the filter field', async ({
	page
}) => {
	await openEmptyApp(page);
	const labels = page.getByRole('region', { name: 'Labels' });
	// A short list has no filter field to mistake for a place to create.
	await expect(labels.getByRole('textbox', { name: 'Filter labels' })).toHaveCount(0);

	await labels.getByRole('button', { name: 'New label' }).click();
	const name = labels.getByRole('textbox', { name: 'New label name' });
	await expect(name).toBeFocused();
	await name.fill('Reading');
	await name.press('Escape');
	await expect(name).toHaveCount(0);
	await expect(labels.getByRole('button', { name: 'Reading', exact: true })).toHaveCount(0);

	await labels.getByRole('button', { name: 'New label' }).click();
	await labels.getByRole('textbox', { name: 'New label name' }).fill('Reading');
	await page.keyboard.press('Enter');
	// The new label opens; empty, it shows its empty state rather than a heading.
	await expect(page).toHaveURL(/\/label\//);
	await expect(page).toHaveTitle(/^Reading/);
	await expect(labels.getByRole('button', { name: 'Reading', exact: true })).toBeVisible();
});

test('a new board explains that columns are labels and starts from a template', async ({
	page
}) => {
	await openEmptyApp(page);
	await page.goto('/kanban');
	// Backlog alone: the first run. The panel says what a column is and offers a start.
	await expect(page.locator('[data-kanban-column]')).toHaveCount(1);
	const starter = page.getByRole('region', { name: 'Boards group your notes by label' });
	await expect(starter).toBeVisible();
	await expect(page.locator('[data-kanban-column]').first()).toContainText('Notes in no column');

	await starter.getByRole('button', { name: 'To-Do · In-Progress · Done' }).click();
	await expect(page.locator('[data-kanban-column]')).toHaveCount(4);
	await expect(starter).toHaveCount(0);
	const doing = page.locator('[data-kanban-column]', { hasText: 'In-Progress' });
	await expect(doing).toContainText('Notes labelled In-Progress');
	// The template's labels exist for the rest of the app too.
	await expect(
		page.getByRole('region', { name: 'Labels' }).getByRole('button', { name: 'Done', exact: true })
	).toBeVisible();

	// "New label…" makes a label and its column in one go.
	await page.getByRole('button', { name: 'Add a label column' }).click();
	await page.getByRole('menuitem', { name: 'New label…' }).click();
	await page.getByRole('textbox', { name: 'Label name' }).fill('Blocked');
	await page.getByRole('button', { name: 'Create label' }).click();
	await expect(page.locator('[data-kanban-column]', { hasText: 'Blocked' })).toContainText(
		'Notes labelled Blocked'
	);
});

test('a column has a menu to rename its label, move it and remove it, and shows its count', async ({
	page
}) => {
	await openEmptyApp(page);
	await createNote(page, 'Task one');
	await page.goto('/kanban');
	await page
		.getByRole('region', { name: 'Boards group your notes by label' })
		.getByRole('button', { name: 'To-Do · In-Progress · Done' })
		.click();
	const unsorted = page.getByRole('region', { name: 'Unsorted Kanban column' });
	await expect(unsorted.getByRole('heading', { level: 2 })).toHaveText(/Unsorted\s*1/);

	await page.getByRole('button', { name: 'To-Do column actions' }).click();
	await page.getByRole('menuitem', { name: 'Rename label…' }).click();
	await page.getByRole('textbox', { name: 'Label name' }).fill('Next');
	await page.getByRole('button', { name: 'Rename', exact: true }).click();
	await expect(page.getByRole('region', { name: 'Next label column' })).toBeVisible();

	await page.getByRole('button', { name: 'Next column actions' }).click();
	await page.getByRole('menuitem', { name: 'Move right' }).click();
	const names = page.getByRole('region', { name: /column$/ });
	await expect(names).toHaveText([/Unsorted/, /In-Progress/, /Next/, /Done/]);

	await page.getByRole('button', { name: 'Done column actions' }).click();
	await expect(page.getByText('The label and its notes stay.')).toBeVisible();
	await page.getByRole('menuitem', { name: 'Remove column' }).click();
	await expect(names).toHaveCount(3);
	// The label still exists for the rest of the app.
	await expect(
		page.getByRole('region', { name: 'Labels' }).getByRole('button', { name: 'Done', exact: true })
	).toBeVisible();

	// A card moves from its menu as well as by a drag, and says so.
	await moveTo(noteCard(page, 'Task one'), 'In-Progress');
	await expect(page.getByRole('status')).toContainText('Moved to In-Progress');
	await expect(
		page.getByRole('region', { name: 'In-Progress label column' }).getByRole('article')
	).toHaveCount(1);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test('the board shows one column at a time with a tab for each', async ({ page }) => {
		await openEmptyApp(page);
		await createNote(page, 'Task one');
		await page.goto('/kanban');
		await page
			.getByRole('region', { name: 'Boards group your notes by label' })
			.getByRole('button', { name: 'To-Do · In-Progress · Done' })
			.click();
		const tabs = page.getByRole('tablist', { name: 'Columns' }).getByRole('tab');
		await expect(tabs).toHaveText([/Unsorted\s*1/, /To-Do\s*0/, /In-Progress\s*0/, /Done\s*0/]);
		await expect(page.getByRole('region', { name: /column$/ })).toHaveCount(1);
		await expect(page.getByRole('region', { name: 'Unsorted Kanban column' })).toBeVisible();

		await tabs.nth(2).click();
		await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
		await expect(page.getByRole('region', { name: 'In-Progress label column' })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Unsorted Kanban column' })).toHaveCount(0);

		// Move to… from the card: the board follows the card.
		await tabs.nth(0).click();
		await moveTo(noteCard(page, 'Task one'), 'Done');
		await expect(page.getByRole('region', { name: 'Done label column' })).toBeVisible();
		await expect(tabs.nth(3)).toHaveText(/Done\s*1/);
	});
});
