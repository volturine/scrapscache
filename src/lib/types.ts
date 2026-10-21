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

/** Colour names, for menus, chips and assistive technology. */
export const NOTE_COLOR_NAMES: Record<NoteColor, string> = {
	default: 'Default',
	red: 'Red',
	orange: 'Orange',
	yellow: 'Yellow',
	green: 'Green',
	teal: 'Teal',
	blue: 'Blue',
	darkblue: 'Dark blue',
	purple: 'Purple',
	pink: 'Pink',
	brown: 'Brown',
	gray: 'Grey'
};
