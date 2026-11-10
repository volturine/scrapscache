import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** Bytes written per call, so a large backup never crosses to the shell as one string. */
const CHUNK_BYTES = 768 * 1024;

/** What the share plugin rejects with when the sheet is closed without a choice. */
const CANCELED = 'Share canceled';

/**
 * Hand a file to iOS's share sheet, which saves it to Files or Photos or sends
 * it on. The page cannot do this itself: the web view drops a download link,
 * and its own share needs a tap younger than a backup takes to encrypt. The
 * file is written to the app's cache in pieces and removed when the sheet
 * closes; closing the sheet without a choice is not an error.
 */
export async function shareFile(file: Blob, name: string): Promise<void> {
	const folder = `share/${crypto.randomUUID()}`;
	const path = `${folder}/${fileName(name)}`;
	try {
		await Filesystem.writeFile({
			path,
			directory: Directory.Cache,
			recursive: true,
			data: await base64(file.slice(0, CHUNK_BYTES))
		});
		for (let start = CHUNK_BYTES; start < file.size; start += CHUNK_BYTES) {
			await Filesystem.appendFile({
				path,
				directory: Directory.Cache,
				data: await base64(file.slice(start, start + CHUNK_BYTES))
			});
		}
		const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
		await Share.share({ files: [uri] });
	} catch (err) {
		if (!(err instanceof Error && err.message === CANCELED)) throw err;
	} finally {
		await Filesystem.rmdir({ path: folder, directory: Directory.Cache, recursive: true }).catch(
			() => undefined
		);
	}
}

/** A name iOS can save under: one path segment, never empty. */
export function fileName(name: string): string {
	const safe = name.replace(/[/\\:\u0000-\u001f]/g, '-').trim();
	return safe && safe !== '.' && safe !== '..' ? safe : 'file';
}

function base64(part: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
		reader.onload = () => {
			const url = String(reader.result);
			resolve(url.slice(url.indexOf(',') + 1));
		};
		reader.readAsDataURL(part);
	});
}
