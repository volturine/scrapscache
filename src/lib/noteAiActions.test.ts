import { describe, expect, it } from 'vitest';
import {
	NOTE_AI_ACTIONS,
	NOTE_AI_INPUT_LIMIT,
	NoteAiAction,
	NoteAiApply,
	noteAiLabel,
	noteAiMessages,
	noteAiResult,
	translationLanguage
} from './noteAiActions';

const NOTE = { title: '  Trip  ', body: 'Pack socks\n' };

describe('noteAiMessages', () => {
	it('sends the title with the body for a summary', () => {
		const [system, user] = noteAiMessages(NoteAiAction.Summarize, NOTE, 'English');
		expect(system.role).toBe('system');
		expect(user).toEqual({ role: 'user', content: 'Title: Trip\n\nPack socks' });
	});

	it('sends only the body for rewrites, so the title cannot leak into it', () => {
		for (const action of [
			NoteAiAction.Checklist,
			NoteAiAction.Proofread,
			NoteAiAction.Shorten,
			NoteAiAction.Translate
		]) {
			expect(NOTE_AI_ACTIONS[action].apply).toBe(NoteAiApply.ReplaceBody);
			expect(noteAiMessages(action, NOTE, 'English')[1].content).toBe('Pack socks');
		}
	});

	it('names the target language in the translation prompt', () => {
		const [system] = noteAiMessages(NoteAiAction.Translate, NOTE, 'Slovak');
		expect(system.content).toContain('into Slovak');
	});

	it('cuts long notes to fit the context window', () => {
		const long = { title: '', body: 'x'.repeat(NOTE_AI_INPUT_LIMIT * 2) };
		expect(noteAiMessages(NoteAiAction.Summarize, long, 'English')[1].content).toHaveLength(
			NOTE_AI_INPUT_LIMIT
		);
	});
});

describe('translationLanguage', () => {
	it('names the browser language in English', () => {
		expect(translationLanguage('sk-SK')).toBe('Slovak');
		expect(translationLanguage('en')).toBe('English');
		expect(noteAiLabel(NoteAiAction.Translate, 'Slovak')).toBe('Translate to Slovak');
	});
});

describe('noteAiResult', () => {
	it('turns any list the model writes into app checklist lines', () => {
		const reply = '- bread\n* milk\n1. eggs\n\n[x] post office\n  [ ] cake\nbuy flowers';
		expect(noteAiResult(NoteAiAction.Checklist, reply)).toBe(
			'[ ] bread\n[ ] milk\n[ ] eggs\n[x] post office\n  [ ] cake\n[ ] buy flowers'
		);
	});

	it('unwraps a code fence around the reply', () => {
		expect(noteAiResult(NoteAiAction.Proofread, '```text\nFixed note.\n```')).toBe('Fixed note.');
	});

	it('keeps a title to one clean line', () => {
		expect(noteAiResult(NoteAiAction.Title, '"Weekend trip to the lake."\nMore')).toBe(
			'Weekend trip to the lake'
		);
		expect(noteAiResult(NoteAiAction.Title, '# Title: Groceries')).toBe('Groceries');
	});

	it('drops trailing spaces the model adds as line breaks', () => {
		expect(noteAiResult(NoteAiAction.Proofread, 'Nákup  \nV sobotu.  ')).toBe('Nákup\nV sobotu.');
	});

	it('leaves other replies as written', () => {
		expect(noteAiResult(NoteAiAction.Shorten, '  Pack socks.\n- tent  ')).toBe(
			'Pack socks.\n- tent'
		);
	});
});
