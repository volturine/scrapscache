// Shared context: open existing note or start a new one in the same editor modal.
import { getContext, setContext } from 'svelte';

export type EditorActions = {
	openNote: (id: string) => void;
	startNewNote: (seed?: { title?: string; body?: string }) => void;
	/** Saves and puts away the open note; done once it and its history entry are gone. */
	closeNote: () => Promise<void>;
};

const KEY = Symbol('editorActions');

export function provideEditorActions(actions: EditorActions): void {
	setContext<EditorActions>(KEY, actions);
}

export function useEditorActions(): EditorActions {
	const fn = getContext<EditorActions>(KEY);
	if (!fn) {
		return { openNote: () => {}, startNewNote: () => {}, closeNote: async () => {} };
	}
	return fn;
}
