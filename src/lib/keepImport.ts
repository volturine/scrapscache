import { unzip } from 'fflate';
import { blobToDataUrl } from './imageBlob';
import { localLinkCard, normalizePreviewUrl, type LinkPreview } from './linkPreview';
import { NOTE_FIELDS } from './model';
import type { Label, Note, NoteColor, NoteImage } from './types';
import { uid } from './utils';

export type KeepParsedNote = {
	title: string;
	body: string;
	color: NoteColor;
	pinned: boolean;
	archived: boolean;
	trashed: boolean;
	createdAt: number;
	updatedAt: number;
	labelNames: string[];
	attachments: { fileName: string; mime: string }[];
	linkPreviews: LinkPreview[];
};

export type KeepTakeoutParsed = {
	notes: KeepParsedNote[];
	labelNames: string[];
};

const KEEP_COLORS: Record<string, NoteColor> = {
	default: 'default',
	red: 'red',
	orange: 'orange',
	yellow: 'yellow',
	green: 'green',
	teal: 'teal',
	blue: 'blue',
	cerulean: 'darkblue',
	darkblue: 'darkblue',
	purple: 'purple',
	pink: 'pink',
	brown: 'brown',
	gray: 'gray',
	grey: 'gray'
};

const decoder = new TextDecoder();

export function isZipBytes(bytes: Uint8Array): boolean {
	return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function unzipKeepTakeout(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
	return new Promise((resolve, reject) => {
		unzip(
			bytes,
			{
				filter: (file) => {
					const name = file.name.replaceAll('\\', '/').toLowerCase();
					if (!name || name.endsWith('/')) return false;
					return !name.endsWith('.html') && !name.endsWith('.htm') && !name.endsWith('.css');
				}
			},
			(err, data) => {
				if (err) reject(new Error('Could not read that zip file.'));
				else resolve(data);
			}
		);
	});
}

function indexKeepFiles(files: Record<string, Uint8Array>): Map<string, Uint8Array> {
	const indexed = new Map<string, Uint8Array>();
	for (const [path, bytes] of Object.entries(files)) {
		const normalized = path.replaceAll('\\', '/');
		if (!normalized || normalized.endsWith('/')) continue;
		indexed.set(normalized, bytes);
		indexed.set(normalized.toLowerCase(), bytes);
		const base = fileName(normalized);
		if (base && !indexed.has(base)) indexed.set(base, bytes);
		const lowerBase = base.toLowerCase();
		if (lowerBase && !indexed.has(lowerBase)) indexed.set(lowerBase, bytes);
	}
	return indexed;
}

export function readKeepTakeout(files: Record<string, Uint8Array>): KeepTakeoutParsed {
	const labelNames: string[] = [];
	const seenLabels = new Set<string>();
	const notes: KeepParsedNote[] = [];

	for (const [path, bytes] of Object.entries(files)) {
		const base = fileName(path.replaceAll('\\', '/'));
		if (base.toLowerCase() === 'labels.txt') {
			for (const name of decoder.decode(bytes).split(/\r?\n/)) {
				addLabelName(labelNames, seenLabels, name);
			}
		}
	}

	for (const [path, bytes] of Object.entries(files)) {
		if (!fileName(path).toLowerCase().endsWith('.json')) continue;
		let raw: unknown;
		try {
			raw = JSON.parse(decoder.decode(bytes));
		} catch {
			continue;
		}
		const note = parseKeepNote(raw, timestampFromKeepFilename(path));
		if (!note) continue;
		notes.push(note);
		for (const name of note.labelNames) addLabelName(labelNames, seenLabels, name);
	}

	return { notes, labelNames };
}

export async function materializeKeepTakeout(
	files: Record<string, Uint8Array>,
	encodeAttachment: (file: File) => Promise<NoteImage> = encodeKeepAttachment
): Promise<{ notes: Note[]; labels: Label[] }> {
	const parsed = readKeepTakeout(files);
	const indexed = indexKeepFiles(files);
	const now = Date.now();
	const labels: Label[] = parsed.labelNames.map((name) => ({
		id: uid(),
		name,
		createdAt: now,
		updatedAt: now
	}));
	const labelIds = new Map(labels.map((label) => [label.name.trim().toLowerCase(), label.id]));
	const notes: Note[] = [];
	for (const source of parsed.notes) {
		const images: NoteImage[] = [];
		for (const attachment of source.attachments) {
			const bytes =
				indexed.get(attachment.fileName) ?? indexed.get(attachment.fileName.toLowerCase());
			if (!bytes) continue;
			const copy = bytes.slice();
			const mime = attachment.mime || 'application/octet-stream';
			const file = new File([new Blob([copy], { type: mime })], attachment.fileName, {
				type: mime
			});
			images.push(await encodeAttachment(file));
		}
		const fieldTimes = Object.fromEntries(NOTE_FIELDS.map((field) => [field, source.updatedAt]));
		notes.push({
			id: uid(),
			title: source.title,
			body: source.body,
			color: source.color,
			pinned: source.pinned,
			archived: source.archived,
			trashed: source.trashed,
			trashedAt: source.trashed ? source.updatedAt : null,
			createdAt: source.createdAt,
			updatedAt: source.updatedAt,
			reminder: null,
			labels: source.labelNames.flatMap((name) => {
				const id = labelIds.get(name.trim().toLowerCase());
				return id ? [id] : [];
			}),
			images,
			fieldTimes,
			...(source.linkPreviews.length ? { linkPreviews: source.linkPreviews } : {})
		});
	}
	return { notes, labels };
}

function encodeKeepAttachment(file: File): Promise<NoteImage> {
	return blobToDataUrl(file).then((dataUrl) => ({
		id: uid(),
		mime: file.type || 'application/octet-stream',
		dataUrl,
		name: file.name,
		createdAt: Date.now(),
		byteSize: file.size
	}));
}

export function parseKeepNote(raw: unknown, fallbackTime?: number | null): KeepParsedNote | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const note = raw as Record<string, unknown>;
	if (
		!('userEditedTimestampUsec' in note) &&
		!('createdTimestampUsec' in note) &&
		!('isTrashed' in note) &&
		!('isPinned' in note) &&
		!('isArchived' in note)
	) {
		return null;
	}
	const createdAt = usecToMs(note.createdTimestampUsec);
	const updatedAt =
		usecToMs(note.userEditedTimestampUsec) ?? createdAt ?? fallbackTime ?? Date.now();
	const listBody = listContentToBody(note.listContent);
	const textBody = typeof note.textContent === 'string' ? note.textContent : '';
	return {
		title: typeof note.title === 'string' ? note.title.trim() : '',
		body: listBody || textBody,
		color: keepColor(note.color),
		pinned: Boolean(note.isPinned),
		archived: Boolean(note.isArchived),
		trashed: Boolean(note.isTrashed),
		createdAt: createdAt ?? updatedAt,
		updatedAt,
		labelNames: labelNamesFrom(note.labels),
		attachments: attachmentsFrom(note.attachments),
		linkPreviews: previewsFrom(note.annotations)
	};
}

function keepColor(value: unknown): NoteColor {
	const key = String(value ?? 'DEFAULT')
		.trim()
		.toLowerCase();
	return KEEP_COLORS[key] ?? 'default';
}

function usecToMs(value: unknown): number | null {
	const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.round(n / 1000);
}

function listContentToBody(value: unknown, indent = 0): string {
	if (!Array.isArray(value)) return '';
	const lines: string[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const text = typeof row.text === 'string' ? row.text : '';
		const checked = Boolean(row.isChecked) || Boolean(row.checked);
		lines.push(`${'  '.repeat(indent)}[${checked ? 'x' : ' '}] ${text}`);
		const children = row.childListItems ?? row.childListItem;
		const nested = listContentToBody(children, indent + 1);
		if (nested) lines.push(nested);
	}
	return lines.join('\n');
}

function labelNamesFrom(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const names: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const name =
			typeof item === 'string'
				? item
				: item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
					? (item as { name: string }).name
					: '';
		addLabelName(names, seen, name);
	}
	return names;
}

function attachmentsFrom(value: unknown): { fileName: string; mime: string }[] {
	if (!Array.isArray(value)) return [];
	const attachments: { fileName: string; mime: string }[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const path = typeof row.filePath === 'string' ? row.filePath.replaceAll('\\', '/') : '';
		const fileNameValue = fileName(path);
		if (!fileNameValue) continue;
		const mime =
			(typeof row.mimetype === 'string' && row.mimetype) ||
			(typeof row.mimeType === 'string' && row.mimeType) ||
			'application/octet-stream';
		attachments.push({ fileName: fileNameValue, mime });
	}
	return attachments;
}

function previewsFrom(value: unknown): LinkPreview[] {
	if (!Array.isArray(value)) return [];
	const previews: LinkPreview[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const url = typeof row.url === 'string' ? row.url : '';
		const normalized = normalizePreviewUrl(url);
		if (!normalized || seen.has(normalized)) continue;
		const card = localLinkCard(normalized);
		if (!card) continue;
		seen.add(normalized);
		const title = typeof row.title === 'string' ? row.title.trim() : '';
		const description = typeof row.description === 'string' ? row.description.trim() : '';
		previews.push({
			url: normalized,
			hostname: card.hostname,
			title: title || card.hostname,
			...(description ? { description } : {})
		});
	}
	return previews;
}

function addLabelName(names: string[], seen: Set<string>, raw: string): void {
	const name = raw.trim();
	if (!name) return;
	const key = name.toLowerCase();
	if (seen.has(key)) return;
	seen.add(key);
	names.push(name);
}

function fileName(path: string): string {
	const parts = path.split('/');
	return parts[parts.length - 1] ?? '';
}

function timestampFromKeepFilename(path: string): number | null {
	const base = fileName(path).replace(/\.json$/i, '');
	const restored = base
		.replace(/T(\d{2})_(\d{2})_(\d{2})/, 'T$1:$2:$3')
		.replace(/([+-]\d{2})_(\d{2})$/, '$1:$2');
	const ms = Date.parse(restored);
	return Number.isFinite(ms) ? ms : null;
}
