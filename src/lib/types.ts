// Core domain types for Scraps Cache notes live in the shared model.
import type { NoteColor } from './model/types';

export type {
	Label,
	LinkPreview,
	Note,
	NoteAttachment,
	NoteColor,
	NoteField,
	NoteFieldTimes,
	NoteImage
} from './model/types';

/** Ordered list for the palette popover. */
export const NOTE_COLOR_ORDER: NoteColor[] = [
	'default',
	'red',
	'orange',
	'yellow',
	'green',
	'teal',
	'blue',
	'darkblue',
	'purple',
	'pink',
	'brown',
	'gray'
];
