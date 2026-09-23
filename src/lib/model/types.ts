// Note records as stored and synced. Shared by the app and the MCP server, so
// every writer produces the same shape.

export type NoteColor =
	| 'default'
	| 'red'
	| 'orange'
	| 'yellow'
	| 'green'
	| 'teal'
	| 'blue'
	| 'darkblue'
	| 'purple'
	| 'pink'
	| 'brown'
	| 'gray';

export type LinkPreview = {
	url: string;
	hostname: string;
	title: string;
	description?: string;
	image?: string;
	icon?: string;
};

export interface NoteImage {
	id: string;
	mime: string;
	/**
	 * Full attachment bytes as a data URL when loaded into memory.
	 * Empty while only the resident thumbnail is held for grid/list display.
	 */
	dataUrl: string;
	/** Small always-resident preview for photos and editable canvases. */
	thumbUrl?: string;
	name?: string;
	createdAt: number;
	/** Last content change (crop, canvas edit); decides between two copies of one attachment. */
	editedAt?: number;
	/** Decoded image dimensions or drawing content bounds. */
	width?: number;
	height?: number;
	/** Stored attachment bytes, excluding data-URL overhead. */
	byteSize?: number;
	/** SHA-256 of the stored data URL, retained when full bytes leave memory. */
	contentHash?: string;
	/** Attachment encoding recipe used to produce the stored bytes. */
	encodingVersion?: number;
}

/** Alias for clarity; same shape as NoteImage (wire field remains `images`). */
export type NoteAttachment = NoteImage;

/** Per-field write times for last-write-wins merge. Missing keys fall back to `updatedAt`. */
export type NoteFieldTimes = {
	title?: number;
	body?: number;
	color?: number;
	pinned?: number;
	archived?: number;
	trashed?: number;
	secret?: number;
	reminder?: number;
	labels?: number;
	images?: number;
	linkPreviews?: number;
};

export type NoteField = keyof NoteFieldTimes;

export interface Note {
	id: string;
	title: string;
	/** Plain text body. Supports `[ ]` / `[x]` checklist lines and `- ` bullet lines. */
	body: string;
	/** The body as a Yjs document (base64 update), so concurrent edits merge instead of replacing. */
	bodyDoc?: string;
	/** Attachments (photos, files, and canvases). `images` is the canonical note field. */
	images?: NoteImage[];
	/** Removed attachment ids and when, so a merge cannot bring them back. */
	imageTombstones?: Record<string, number>;
	/** Saved link metadata so previews remain rich after a note is saved or synced. */
	linkPreviews?: LinkPreview[];
	color: NoteColor;
	pinned: boolean;
	archived: boolean;
	trashed: boolean;
	trashedAt: number | null;
	secret?: boolean;
	createdAt: number;
	updatedAt: number;
	reminder: number | null; // epoch ms
	labels: string[]; // label ids
	fieldTimes?: NoteFieldTimes;
	/** Writer of each field's current value; breaks ties between equal field times. */
	fieldWriters?: Partial<Record<NoteField, string>>;
}

export interface Label {
	id: string;
	name: string;
	createdAt: number;
	/** Changes on rename; used for deterministic offline/cloud conflict resolution. */
	updatedAt: number;
	/** Writer of the current name; breaks ties between equal times. */
	writer?: string;
}
