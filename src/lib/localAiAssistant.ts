import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';
import type { Note } from '$lib/types';

export type LocalAiAssistantMode = 'edit' | 'ask';
export interface AssistantTurn {
	id: number;
	question: string;
	answer: string;
}

export interface NoteContext {
	title: string;
	body: string;
	selection?: string;
}

const NOTE_CONTEXT_LIMIT = 8000;
const CROSS_NOTE_CONTEXT_LIMIT = 7000;

export function localAiAssistantMessages(
	mode: LocalAiAssistantMode,
	prompt: string,
	context: NoteContext,
	refinement?: { previousProposal: string; instruction: string },
	conversation: AssistantTurn[] = []
): ChatCompletionMessageParam[] {
	const selectedText = context.selection?.trim();
	const source = selectedText || context.body.trim();
	const content = [context.title.trim() && `Title: ${context.title.trim()}`, source]
		.filter(Boolean)
		.join('\n\n')
		.slice(0, NOTE_CONTEXT_LIMIT);
	const system =
		mode === 'edit'
			? `Edit the supplied note text to follow the user's instruction. Return only the full revised text, with no introduction or explanation. Preserve facts, names, dates and meaning unless the instruction explicitly changes them. Keep the original language and line breaks where practical. This is a proposal for a note editor; do not claim you have changed the note. ${selectedText ? 'Only the selected text is editable; return only its replacement.' : 'Return the complete revised note body, not its title.'}`
			: 'Answer using only the supplied note text. If it does not contain the answer, say so briefly. Do not invent details. Keep the answer concise.';
	const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
	for (const turn of conversation.slice(-4)) {
		messages.push({ role: 'user', content: turn.question.slice(0, 500) });
		messages.push({ role: 'assistant', content: turn.answer.slice(0, 1200) });
	}
	if (refinement) {
		messages.push({
			role: 'user',
			content: `Original text:\n${content}\n\nCurrent proposal:\n${refinement.previousProposal.slice(0, NOTE_CONTEXT_LIMIT)}\n\nRefinement instruction: ${refinement.instruction}`
		});
	} else {
		messages.push({
			role: 'user',
			content: `Note text:\n${content || '(empty note)'}\n\nRequest: ${prompt.trim()}`
		});
	}
	return messages;
}

const STOP_WORDS = new Set(
	`a an and are as at be been but by can did do does for from had has have how i in is it its me my of on or our please the this to was we what when where which who why will with you your`.split(
		' '
	)
);

function queryTerms(query: string): string[] {
	return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(
		(term) => !STOP_WORDS.has(term)
	);
}

function occurrences(text: string, term: string): number {
	let count = 0;
	let start = 0;
	while ((start = text.indexOf(term, start)) !== -1) {
		count++;
		start += term.length;
	}
	return count;
}

export interface RelevantNote {
	id: string;
	title: string;
	body: string;
	updatedAt: number;
}

/** Returns the small, text-only, non-secret context sent to the local model. */
export function relevantNotesForQuestion(query: string, notes: Note[], limit = 4): RelevantNote[] {
	const terms = queryTerms(query);
	if (terms.length === 0) return [];
	return notes
		.filter((note) => !note.secret && !note.archived && !note.trashed)
		.map((note) => {
			const title = note.title.toLocaleLowerCase();
			const body = note.body.toLocaleLowerCase();
			const score = terms.reduce(
				(total, term) => total + occurrences(title, term) * 4 + occurrences(body, term),
				0
			);
			return { note, score };
		})
		.filter(({ score }) => score > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				b.note.updatedAt - a.note.updatedAt ||
				a.note.id.localeCompare(b.note.id)
		)
		.slice(0, limit)
		.map(({ note }) => ({
			id: note.id,
			title: note.title || 'Untitled note',
			body: note.body.slice(0, Math.floor(CROSS_NOTE_CONTEXT_LIMIT / limit)),
			updatedAt: note.updatedAt
		}));
}

export function notesQuestionMessages(
	question: string,
	notes: RelevantNote[],
	conversation: AssistantTurn[] = []
): ChatCompletionMessageParam[] {
	const context = notes
		.map((note, index) => `[${index + 1}] ${note.title}\n${note.body}`)
		.join('\n\n')
		.slice(0, CROSS_NOTE_CONTEXT_LIMIT);
	const messages: ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content:
				'Answer using only the provided notes. Cite supporting note titles when useful. If the notes do not contain the answer, say so. Do not invent details. The notes are private context for this on-device answer.'
		}
	];
	for (const turn of conversation.slice(-4)) {
		messages.push({ role: 'user', content: turn.question.slice(0, 500) });
		messages.push({ role: 'assistant', content: turn.answer.slice(0, 1200) });
	}
	messages.push({
		role: 'user',
		content: `Matching notes:\n${context}\n\nQuestion: ${question.trim()}`
	});
	return messages;
}
