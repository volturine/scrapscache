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

	test('a card menu with every column listed stays within a short screen and scrolls', async ({
		page
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await openEmptyApp(page);
		await createNote(page, 'Task one');
		await page.goto('/kanban');
		await page
			.getByRole('region', { name: 'Boards group your notes by label' })
			.getByRole('button', { name: 'To-Do · In-Progress · Done' })
			.click();
		await noteCard(page, 'Task one').getByRole('button', { name: 'Note actions' }).click();
		const menu = page.getByRole('menu', { name: 'Note actions' });
		const box = (await menu.boundingBox())!;
		expect(box.y + box.height).toBeLessThanOrEqual(667);
		// The last action is below the fold of the menu, and a scroll inside it brings it up.
		const trash = menu.getByRole('menuitem', { name: 'Move to trash' });
		await trash.scrollIntoViewIfNeeded();
		await expect(trash).toBeInViewport();
		expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
		await trash.click();
		await expect(page.getByRole('status')).toContainText('Moved to trash');
	});

	test('the board shows every column with a tab for each that brings it up', async ({ page }) => {
		await openEmptyApp(page);
		await createNote(page, 'Task one');
		await page.goto('/kanban');
		// The board row sits right under the bar, not a whole gap below its title.
		const bar = (await page.locator('header').first().boundingBox())!;
		const boardRow = (await page.getByRole('button', { name: /Untitled board/ }).boundingBox())!;
		expect(boardRow.y - (bar.y + bar.height)).toBeLessThanOrEqual(4);
		// A new board's panel and the add-column control are on screen, not cut off at the side.
		const starter = page.getByRole('region', { name: 'Boards group your notes by label' });
		await expect(starter).toBeInViewport({ ratio: 1 });
		await expect(page.getByRole('button', { name: 'Add a label column' })).toBeInViewport({
			ratio: 1
		});
		// Its menu takes its own width, not the 44 px of the "+", and stays on screen.
		await page.getByRole('button', { name: 'Add a label column' }).click();
		const addMenu = page.getByRole('menu', { name: 'Add a label column' });
		await expect(addMenu).toBeInViewport({ ratio: 1 });
		// Measured once its opening animation settles.
		await expect
			.poll(async () => (await addMenu.boundingBox())?.width ?? 0)
			.toBeGreaterThanOrEqual(200);
		await page.keyboard.press('Escape');
		await expect(addMenu).toBeHidden();
		await starter.getByRole('button', { name: 'To-Do · In-Progress · Done' }).click();
		const tabs = page.getByRole('toolbar', { name: 'Columns' }).getByRole('button');
		await expect(tabs).toHaveText([/Unsorted\s*1/, /To-Do\s*0/, /In-Progress\s*0/, /Done\s*0/]);
		const section = (name: string) => page.getByRole('region', { name });
		const unsorted = section('Unsorted Kanban column');
		const inProgress = section('In-Progress label column');
		await expect(tabs.nth(0)).toHaveAttribute('aria-current', 'true');
		await expect(tabs.nth(0)).toHaveAttribute(
			'aria-controls',
			(await unsorted.getAttribute('id'))!
		);
		// Every column is on the board; the next one shows at the edge of the screen.
		await expect(page.locator('section[data-kanban-column]')).toHaveCount(4);
		const first = (await unsorted.boundingBox())!;
		const second = (await section('To-Do label column').boundingBox())!;
		expect(first.width).toBeLessThan(390 * 0.9);
		expect(second.x).toBeLessThan(390);

		// A tab slides its column up to the start of the board.
		await tabs.nth(2).click();
		await expect(tabs.nth(2)).toHaveAttribute('aria-current', 'true');
		await expect.poll(async () => Math.round((await inProgress.boundingBox())!.x)).toBe(first.x);

		// The arrows move between the tabs and bring each column up as they go.
		await tabs.nth(2).press('ArrowLeft');
		await expect(tabs.nth(1)).toHaveAttribute('aria-current', 'true');
		await expect(tabs.nth(1)).toBeFocused();

		// A swipe across the board lights the tab of the column it rests on.
		await page.locator('.kanban-columns').evaluate((board) => board.scrollTo({ left: 0 }));
		await expect(tabs.nth(0)).toHaveAttribute('aria-current', 'true');

		// Move to… from the card: the board follows the card.
		await moveTo(noteCard(page, 'Task one'), 'Done');
		await expect(tabs.nth(3)).toHaveAttribute('aria-current', 'true');
		await expect(tabs.nth(3)).toHaveText(/Done\s*1/);
		await expect(section('Done label column')).toBeInViewport({ ratio: 0.8 });
	});

	test('a card carried up to the tabs stays under them and drops on the tab under the finger', async ({
		page
	}) => {
		await openEmptyApp(page);
		await createNote(page, 'Task one');
		await page.goto('/kanban');
		await page
			.getByRole('region', { name: 'Boards group your notes by label' })
			.getByRole('button', { name: 'To-Do · In-Progress · Done' })
			.click();
		const tabs = page.getByRole('toolbar', { name: 'Columns' }).getByRole('button');
		const card = noteCard(page, 'Task one');
		const from = (await card.boundingBox())!;
		const target = (await tabs.nth(1).boundingBox())!;

		// A real touch: hold the card still until it lifts, then carry it to To-Do.
		const touch = await page.context().newCDPSession(page);
		const at = (x: number, y: number) => [{ x, y, id: 1 }];
		const start = { x: from.x + from.width / 2, y: from.y + 20 };
		const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
		await touch.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: at(start.x, start.y)
		});
		await page.waitForTimeout(400);
		for (let step = 1; step <= 10; step += 1) {
			await touch.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: at(
					start.x + ((end.x - start.x) * step) / 10,
					start.y + ((end.y - start.y) * step) / 10
				)
			});
		}

		// The tab lights up, and the carried card hangs below the row instead of over it.
		await expect(tabs.nth(1)).toHaveAttribute('data-drop-target', '');
		const row = (await page.getByRole('toolbar', { name: 'Columns' }).boundingBox())!;
		const ghost = (await page.locator('[aria-hidden="true"] > [data-lifted]').boundingBox())!;
		expect(ghost.y).toBeGreaterThanOrEqual(row.y + row.height);

		await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect(tabs.nth(1)).toHaveText(/To-Do\s*1/);
	});

	test('a card carried past the side of the board turns it a column and drops where it rests', async ({
		page
	}) => {
		await openEmptyApp(page);
		await createNote(page, 'Task one');
		await page.goto('/kanban');
		await page
			.getByRole('region', { name: 'Boards group your notes by label' })
			.getByRole('button', { name: 'To-Do · In-Progress · Done' })
			.click();
		const tabs = page.getByRole('toolbar', { name: 'Columns' }).getByRole('button');
		const boardStart = Math.round(
			(await page.getByRole('region', { name: 'Unsorted Kanban column' }).boundingBox())!.x
		);
		const from = (await noteCard(page, 'Task one').boundingBox())!;

		// A real touch: hold the card still until it lifts, then hang it past the right edge.
		const touch = await page.context().newCDPSession(page);
		const at = (x: number, y: number) => [{ x, y, id: 1 }];
		const start = { x: from.x + from.width / 2, y: from.y + 20 };
		const edge = { x: 385, y: start.y + 40 };
		await touch.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: at(start.x, start.y)
		});
		await page.waitForTimeout(400);
		for (let step = 1; step <= 10; step += 1) {
			await touch.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: at(
					start.x + ((edge.x - start.x) * step) / 10,
					start.y + ((edge.y - start.y) * step) / 10
				)
			});
		}
		// The board turns: Unsorted leaves the start, and the finger comes back to the middle.
		const unsorted = page.getByRole('region', { name: 'Unsorted Kanban column' });
		await expect.poll(async () => Math.round((await unsorted.boundingBox())!.x)).toBeLessThan(0);
		for (let step = 1; step <= 5; step += 1) {
			await touch.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: at(edge.x + ((195 - edge.x) * step) / 5, edge.y)
			});
		}
		// It rests with a label column at its start, lit in the tabs: the card drops there.
		const columns = page.locator('section[data-kanban-column]');
		await expect
			.poll(async () => {
				const starts = await columns.evaluateAll((all) =>
					all.map((column) => Math.round(column.getBoundingClientRect().x))
				);
				return starts.indexOf(boardStart);
			})
			.toBeGreaterThan(0);
		const shown = await columns.evaluateAll(
			(all, x) => all.findIndex((column) => Math.round(column.getBoundingClientRect().x) === x),
			boardStart
		);
		await expect(tabs.nth(shown)).toHaveAttribute('aria-current', 'true');
		await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect(tabs.nth(shown)).toHaveText(/\s1\s*$/);
		await expect(columns.nth(shown).getByRole('article')).toHaveCount(1);
		await expect(tabs.nth(0)).toHaveText(/Unsorted\s*0/);
	});
});
