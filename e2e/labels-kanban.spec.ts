import { expect, test } from '@playwright/test';
import { createNote, noteCard, openEmptyApp, quickAction } from './app';
import type { Locator, Page } from '@playwright/test';

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

	await starter.getByRole('button', { name: 'To-Do · In-Progress · Done' }).click();
	await expect(page.locator('[data-kanban-column]')).toHaveCount(4);
	await expect(starter).toHaveCount(0);
	// The template's labels exist for the rest of the app too.
	await expect(
		page.getByRole('region', { name: 'Labels' }).getByRole('button', { name: 'Done', exact: true })
	).toBeVisible();

	// "New label…" makes a label and its column in one go.
	await page.getByRole('button', { name: 'Add a label column' }).click();
	await page.getByRole('menuitem', { name: 'New label…' }).click();
	await page.getByRole('textbox', { name: 'Label name' }).fill('Blocked');
	await page.getByRole('button', { name: 'Create label' }).click();
	await expect(page.locator('[data-kanban-column]', { hasText: 'Blocked' })).toBeVisible();
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

	test('a status bar down the side of the screen (iPhone Duo folded) leaves the board inside the frame', async ({
		page
	}) => {
		await openEmptyApp(page);
		await createNote(page, 'Task one');
		await page.goto('/kanban');
		// The folded Duo reports its side status bar as a safe-area inset; the frame is 83 px
		// narrower than the viewport, and so must be anything sized from the viewport. A
		// stylesheet, not an inline value: the viewport code rewrites the inline insets.
		await page.addStyleTag({
			content: ':root{--app-inset-right:83px!important;--app-inset-bottom:34px!important}'
		});
		const frameRight = 390 - 83;
		await page
			.getByRole('region', { name: 'Boards group your notes by label' })
			.getByRole('button', { name: 'To-Do · In-Progress · Done' })
			.click();
		const unsorted = (await page
			.getByRole('region', { name: 'Unsorted Kanban column' })
			.boundingBox())!;
		expect(unsorted.x + unsorted.width).toBeLessThanOrEqual(frameRight);
		const actions = (await noteCard(page, 'Task one')
			.getByRole('button', { name: 'Note actions' })
			.boundingBox())!;
		expect(actions.x + actions.width).toBeLessThanOrEqual(frameRight);
		// The tab bar's surface still runs the full width under the status bar.
		const bleed = (await page.locator('[data-tab-bar-bleed]').boundingBox())!;
		expect(bleed.x + bleed.width).toBe(390);
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

		// A tab slides its column up to the start of the board, and stays lit the
		// whole way: the columns the board glides past do not light up on the way.
		const toolbar = page.getByRole('toolbar', { name: 'Columns' });
		await toolbar.evaluate((row) => {
			const lit: number[] = [];
			(window as unknown as { litTabs: number[] }).litTabs = lit;
			new MutationObserver(() =>
				lit.push([...row.children].findIndex((tab) => tab.getAttribute('aria-current') === 'true'))
			).observe(row, { subtree: true, attributeFilter: ['aria-current'] });
		});
		await tabs.nth(2).click();
		await expect(tabs.nth(2)).toHaveAttribute('aria-current', 'true');
		await expect.poll(async () => Math.round((await inProgress.boundingBox())!.x)).toBe(first.x);
		await page.waitForTimeout(200);
		const litOnTheWay = await page.evaluate(
			() => (window as unknown as { litTabs: number[] }).litTabs
		);
		expect(litOnTheWay.filter((tab) => tab !== -1 && tab !== 2)).toEqual([]);

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

test.describe('on a landscape phone', () => {
	test.use({ viewport: { width: 732, height: 540 }, hasTouch: true });

	test('two kanban columns fit on the screen', async ({ page }) => {
		await openEmptyApp(page);
		await createNote(page, 'Task one');
		await page.goto('/kanban');
		await page
			.getByRole('region', { name: 'Boards group your notes by label' })
			.getByRole('button', { name: 'To-Do · In-Progress · Done' })
			.click();
		const first = (await page
			.getByRole('region', { name: 'Unsorted Kanban column' })
			.boundingBox())!;
		const second = (await page.getByRole('region', { name: 'To-Do label column' }).boundingBox())!;
		expect(first.width).toBeLessThanOrEqual(340);
		expect(second.x).toBeGreaterThan(first.x + first.width);
		expect(second.x + second.width).toBeLessThanOrEqual(732);
	});
});

test.describe('a folded Surface Duo', () => {
	test.use({
		viewport: { width: 540, height: 720 },
		hasTouch: true,
		userAgent:
			'Mozilla/5.0 (Linux; Android 12; Surface Duo 2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
	});

	test('keeps the board clear of the side status column', async ({ page }) => {
		await openEmptyApp(page);
		await createNote(page, 'Task one');
		await page.goto('/kanban');
		const right = await page.evaluate(() =>
			Number.parseFloat(
				getComputedStyle(document.documentElement).getPropertyValue('--app-inset-right')
			)
		);
		expect(right).toBeGreaterThanOrEqual(84);
		await page
			.getByRole('region', { name: 'Boards group your notes by label' })
			.getByRole('button', { name: 'To-Do · In-Progress · Done' })
			.click();
		const frameRight = 540 - right;
		const unsorted = (await page
			.getByRole('region', { name: 'Unsorted Kanban column' })
			.boundingBox())!;
		expect(unsorted.x + unsorted.width).toBeLessThanOrEqual(frameRight + 1);
		const add = (await page.getByRole('button', { name: 'Add a label column' }).boundingBox())!;
		expect(add.x + add.width).toBeLessThanOrEqual(frameRight + 1);
		const actions = (await noteCard(page, 'Task one')
			.getByRole('button', { name: 'Note actions' })
			.boundingBox())!;
		expect(actions.x + actions.width).toBeLessThanOrEqual(frameRight + 1);
	});
});

function installSegments(
	page: Page,
	segments: { x: number; y: number; width: number; height: number }[]
) {
	return page.addInitScript((rects) => {
		Object.defineProperty(window, 'viewport', {
			configurable: true,
			value: { segments: rects }
		});
	}, segments);
}

test.describe('a spanned Surface Duo', () => {
	test('a vertical hinge puts one column on each screen and keeps the note on the right', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1114, height: 720 });
		await installSegments(page, [
			{ x: 0, y: 0, width: 540, height: 720 },
			{ x: 574, y: 0, width: 540, height: 720 }
		]);
		await openEmptyApp(page);
		await expect(page.locator('html')).toHaveAttribute('data-viewport-span', 'horizontal');
		await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
		await expect(page.getByRole('textbox', { name: 'Search notes' })).toBeHidden();
		await expect(page.locator('[data-phone-tab-cluster]')).toHaveCount(2);

		await createNote(page, 'Span note');
		const masonry = page.locator('[data-note-masonry]');
		await expect
			.poll(() =>
				masonry.evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length)
			)
			.toBe(7);
		const card = (await noteCard(page, 'Span note').boundingBox())!;
		expect(card.x).toBeLessThan(540);

		await noteCard(page, 'Span note')
			.getByRole('button', { name: /^Open Span note/ })
			.click();
		const editor = page.getByRole('dialog', { name: 'Note editor' });
		await expect(editor).toBeVisible();
		expect((await editor.boundingBox())!.x).toBeGreaterThan(500);
		await page.keyboard.press('Escape');
		await expect(editor).toBeHidden();

		await page.goto('/reminders');
		const split = page.locator('[data-reminder-split]');
		await expect.poll(() => split.evaluate((node) => getComputedStyle(node).display)).toBe('grid');
		expect((await split.locator(':scope > *').first().boundingBox())!.width).toBeGreaterThan(400);

		await page.goto('/kanban');
		await page
			.getByRole('region', { name: 'Boards group your notes by label' })
			.getByRole('button', { name: 'To-Do · In-Progress · Done' })
			.click();
		const first = (await page
			.getByRole('region', { name: 'Unsorted Kanban column' })
			.boundingBox())!;
		const second = (await page.getByRole('region', { name: 'To-Do label column' }).boundingBox())!;
		expect(first.width).toBeGreaterThan(500);
		expect(first.width).toBeLessThan(560);
		expect(second.x).toBeGreaterThan(550);
		expect(second.x).toBeLessThan(600);
		const fold = await page.evaluate(() =>
			Number.parseFloat(getComputedStyle(document.documentElement, '::before').width)
		);
		expect(fold).toBeGreaterThan(20);
	});

	test('a horizontal hinge stretches the columns down both screens', async ({ page }) => {
		await page.setViewportSize({ width: 720, height: 1114 });
		await installSegments(page, [
			{ x: 0, y: 0, width: 720, height: 540 },
			{ x: 0, y: 574, width: 720, height: 540 }
		]);
		await openEmptyApp(page);
		await createNote(page, 'Task one');
		await page.goto('/kanban');
		await expect(page.locator('html')).toHaveAttribute('data-viewport-span', 'vertical');
		await page
			.getByRole('region', { name: 'Boards group your notes by label' })
			.getByRole('button', { name: 'To-Do · In-Progress · Done' })
			.click();
		const column = (await page
			.getByRole('region', { name: 'Unsorted Kanban column' })
			.boundingBox())!;
		expect(column.width).toBeLessThanOrEqual(340);
		expect(column.height).toBeGreaterThan(500);
		const fold = await page.evaluate(() =>
			Number.parseFloat(getComputedStyle(document.documentElement, '::before').height)
		);
		expect(fold).toBeGreaterThan(20);
	});
});
