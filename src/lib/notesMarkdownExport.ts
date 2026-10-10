import { strToU8, zipSync } from 'fflate';
import { dataUrlToBlob } from '#lib/imageBlob.js';
import type { Note, NoteImage } from '#lib/types.js';

function safeSegment(value: string, fallback: string): string {
	const safe = value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[\\/]+/g, '-')
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/^\.+/, '');
	return safe || fallback;
}

function uniqueName(name: string, used: Set<string>): string {
	if (!used.has(name)) {
		used.add(name);
		return name;
	}
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : '';
	let suffix = 2;
	while (used.has(`${stem}-${suffix}${extension}`)) suffix++;
	const unique = `${stem}-${suffix}${extension}`;
	used.add(unique);
	return unique;
}

function attachmentName(image: NoteImage, index: number): string {
	const sourceName = image.name?.split(/[\\/]/).pop()?.trim() || `attachment-${index + 1}`;
	const withExtension = sourceName.includes('.')
		? sourceName
		: `${sourceName}.${
				{
					'application/pdf': 'pdf',
					'application/json': 'json',
					'application/vnd.scrapscache.canvas+json': 'json',
					'image/gif': 'gif',
					'image/jpeg': 'jpg',
					'image/png': 'png',
					'image/webp': 'webp',
					'text/markdown': 'md',
					'text/plain': 'txt'
				}[image.mime.toLowerCase()] ?? 'bin'
			}`;
	return safeSegment(withExtension, `attachment-${index + 1}.bin`);
}

function markdownLabel(value: string): string {
	return value.replace(/\s+/g, ' ').replace(/[\\[\]]/g, '\\$&');
}

function noteMarkdown(title: string, body: string, attachments: string[]): string {
	const parts = [title ? `# ${title.replace(/[\r\n]+/g, ' ').trim()}` : '', body];
	if (attachments.length) parts.push(`## Attachments\n\n${attachments.join('\n')}`);
	return `${parts
		.filter((part) => part !== '')
		.join('\n\n')
		.trimEnd()}\n`;
}

/** Create a readable Markdown export with attachment bytes in a separate folder. */
export async function buildNotesMarkdownZip(notes: Note[]): Promise<Uint8Array> {
	const files: Record<string, Uint8Array> = {};
	const usedNoteNames = new Set<string>();
	const usedAttachmentNames = new Set<string>();

	for (const [noteIndex, note] of notes.entries()) {
		const title = note.title.trim() || `Untitled ${noteIndex + 1}`;
		const noteStem = safeSegment(title, `note-${noteIndex + 1}`);
		const noteFileName = uniqueName(`${noteStem}.md`, usedNoteNames);
		const attachmentLines: string[] = [];

		for (const [attachmentIndex, image] of (note.images ?? []).entries()) {
			if (!image.dataUrl.startsWith('data:')) {
				throw new Error('Could not read an attachment for this export.');
			}

			let bytes: Uint8Array;
			try {
				const blob = await dataUrlToBlob(image.dataUrl);
				bytes = new Uint8Array(await blob.arrayBuffer());
			} catch {
				throw new Error('Could not read an attachment for this export.');
			}

			const fileName = uniqueName(
				`${noteFileName.slice(0, -3)}-${attachmentName(image, attachmentIndex)}`,
				usedAttachmentNames
			);
			files[`notes/attachments/${fileName}`] = bytes;
			const label = markdownLabel(image.name?.trim() || fileName);
			const path = `attachments/${fileName}`;
			attachmentLines.push(
				image.mime.toLowerCase().startsWith('image/')
					? `![${label}](${path})`
					: `- [${label}](${path})`
			);
		}

		files[`notes/${noteFileName}`] = strToU8(noteMarkdown(title, note.body, attachmentLines));
	}

	return zipSync(files);
}
