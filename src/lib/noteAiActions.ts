import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import { formatCheckLine, parseBulletLine, parseCheckLine } from './checklistBody';

export enum NoteAiAction {
	Summarize = 'summarize',
	Checklist = 'checklist',
	Proofread = 'proofread',
	Shorten = 'shorten',
	Translate = 'translate',
	Title = 'title'
}

/** How an accepted result changes the note. */
export enum NoteAiApply {
	Append = 'append',
	ReplaceBody = 'replaceBody',
	Title = 'title'
}

interface NoteAiActionSpec {
	label: string;
	apply: NoteAiApply;
	/** Caps the reply; small models can fall into a loop that would otherwise run for minutes. */
	maxTokens: number;
	/** Rewrites of the body see only the body, so the title cannot leak into it. */
	includeTitle: boolean;
	instruction: (language: string) => string;
}

const SAME_LANGUAGE = 'Write in the language of the note.';
const KEEP_MARKERS = 'Keep its line breaks and any "[ ]", "[x]" or "- " line markers.';
const RESULT_ONLY = 'Reply with the result only, without an introduction or explanation.';

export const NOTE_AI_ACTIONS: Record<NoteAiAction, NoteAiActionSpec> = {
	[NoteAiAction.Summarize]: {
		label: 'Summarize',
		apply: NoteAiApply.Append,
		maxTokens: 256,
		includeTitle: true,
		instruction: () =>
			`Summarize the note in at most three short sentences. ${SAME_LANGUAGE} Do not add anything the note does not say. ${RESULT_ONLY}`
	},
	[NoteAiAction.Checklist]: {
		label: 'Turn into checklist',
		apply: NoteAiApply.ReplaceBody,
		maxTokens: 1024,
		includeTitle: false,
		instruction: () =>
			`Rewrite the note as a to-do checklist with one task per line, each line starting with "[ ] ". Keep every task the note mentions and add none. ${SAME_LANGUAGE} ${RESULT_ONLY}`
	},
	[NoteAiAction.Proofread]: {
		label: 'Fix spelling and grammar',
		apply: NoteAiApply.ReplaceBody,
		maxTokens: 1024,
		includeTitle: false,
		instruction: () =>
			`Correct the spelling, grammar and punctuation of the note. Keep its wording, meaning and language. ${KEEP_MARKERS} ${RESULT_ONLY}`
	},
	[NoteAiAction.Shorten]: {
		label: 'Make shorter',
		apply: NoteAiApply.ReplaceBody,
		maxTokens: 768,
		includeTitle: false,
		instruction: () =>
			`Rewrite the note to about half its length. Keep every fact, date, name and number. ${SAME_LANGUAGE} ${KEEP_MARKERS} ${RESULT_ONLY}`
	},
	[NoteAiAction.Translate]: {
		label: 'Translate',
		apply: NoteAiApply.ReplaceBody,
		maxTokens: 1024,
		includeTitle: false,
		instruction: (language) => `Translate the note into ${language}. ${KEEP_MARKERS} ${RESULT_ONLY}`
	},
	[NoteAiAction.Title]: {
		label: 'Suggest a title',
		apply: NoteAiApply.Title,
		maxTokens: 24,
		includeTitle: false,
		instruction: () =>
			`Write a short title for the note, at most six words. ${SAME_LANGUAGE} Reply with the title only, without quotes.`
	}
};

/** Leaves room for the instruction and the reply inside the 4096-token context window. */
export const NOTE_AI_INPUT_LIMIT = 8000;

/** The language translations target: the browser's own, named in English for the prompt. */
export function translationLanguage(locale: string): string {
	const base = locale.split('-')[0] || 'en';
	try {
		return new Intl.DisplayNames(['en'], { type: 'language' }).of(base) ?? 'English';
	} catch {
		return 'English';
	}
}

export function noteAiLabel(action: NoteAiAction, language: string): string {
	return action === NoteAiAction.Translate
		? `Translate to ${language}`
		: NOTE_AI_ACTIONS[action].label;
}

export function noteAiMessages(
	action: NoteAiAction,
	note: { title: string; body: string },
	language: string
): ChatCompletionMessageParam[] {
	const spec = NOTE_AI_ACTIONS[action];
	const title = spec.includeTitle ? note.title.trim() : '';
	const content = [title && `Title: ${title}`, note.body.trim()]
		.filter(Boolean)
		.join('\n\n')
		.slice(0, NOTE_AI_INPUT_LIMIT);
	return [
		{ role: 'system', content: spec.instruction(language) },
		{ role: 'user', content }
	];
}

function checklistLine(line: string): string {
	const check = parseCheckLine(line);
	if (check) return formatCheckLine(check.indent, check.checked, check.text.trim());
	const bullet = parseBulletLine(line);
	if (bullet) return formatCheckLine(bullet.indent, false, bullet.text.trim());
	return formatCheckLine(0, false, line.trim().replace(/^\d+[.)]\s+/, ''));
}

/**
 * The reply shaped into what the note stores. The prompt asks for the format,
 * but a small model does not always follow it, so the parts the app depends
 * on are enforced here.
 */
export function noteAiResult(action: NoteAiAction, reply: string): string {
	const text = reply
		.trim()
		.replace(/^```[^\n]*\n([\s\S]*?)\n?```$/, '$1')
		// Markdown hard breaks ("line  ") are noise in a plain-text note.
		.replace(/[ \t]+$/gm, '')
		.trim();
	if (action === NoteAiAction.Checklist) {
		return text
			.split('\n')
			.filter((line) => line.trim())
			.map(checklistLine)
			.join('\n');
	}
	if (action === NoteAiAction.Title) {
		return (text.split('\n')[0] ?? '')
			.replace(/^#+\s*/, '')
			.replace(/^(?:title:\s*)/i, '')
			.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
			.replace(/\.$/, '')
			.trim()
			.slice(0, 80);
	}
	return text;
}
