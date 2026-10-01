import { describe, expect, it } from 'vitest';
import type { Note } from '$lib/types';
import {
	localAiAssistantMessages,
	notesQuestionMessages,
	relevantNotesForQuestion
} from './localAiAssistant';

function note(id: string, title: string, body: string, fields: Partial<Note> = {}): Note {
	return {
		id,
		title,
		body,
		color: 'default',
		pinned: false,
		archived: false,
		trashed: false,
		trashedAt: null,
		createdAt: 1,
		updatedAt: 1,
		reminder: null,
		labels: [],
		images: [],
		...fields
	};
}

describe('local AI assistant context', () => {
	it('builds edit prompts that stage a proposal and target selected text only', () => {
		const messages = localAiAssistantMessages('edit', 'make this shorter', {
			title: 'Trip',
			body: 'Original body',
			selection: 'Selected paragraph'
		});

		expect(messages[0]?.content).toContain('Only the selected text is editable');
		expect(messages[1]?.content).toContain('Selected paragraph');
		expect(messages[1]?.content).not.toContain('Original body');
	});

	it('ranks matching notes and excludes secret, archived, and trashed notes', () => {
		const matches = relevantNotesForQuestion('when does my flight land in Lisbon?', [
			note('unrelated', 'Groceries', 'Oat milk and apples'),
			note('flight', 'Lisbon trip', 'Flight lands Thursday at 14:10 in Lisbon.'),
			note('secret', 'Private Lisbon', 'Flight details', { secret: true }),
			note('archived', 'Old flight', 'Lisbon flight', { archived: true }),
			note('trashed', 'Deleted Lisbon', 'Lisbon flight', { trashed: true })
		]);

		expect(matches.map(({ id }) => id)).toEqual(['flight']);
	});

	it('sends only selected note titles and text with a disclosure-ready source list', () => {
		const sources = relevantNotesForQuestion('hotel Lisbon', [
			note('trip', 'Lisbon trip', 'Stay near Alfama, check in after 15:00.')
		]);
		const messages = notesQuestionMessages('When is check in?', sources);

		expect(messages[1]?.content).toContain('Lisbon trip');
		expect(messages[1]?.content).toContain('Stay near Alfama');
		expect(messages[0]?.content).not.toContain('server');
	});
});
