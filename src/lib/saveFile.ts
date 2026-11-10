import { downloadFile } from '@zag-js/file-utils';
import { isNativeApp } from '#lib/native.js';

/**
 * Keep a file outside the app: a download on the web, the share sheet in the
 * iPhone app, whose web view drops a download link without a word.
 */
export async function saveFile(file: Blob, name: string): Promise<void> {
	if (isNativeApp()) {
		const { shareFile } = await import('#lib/native/shareFile.js');
		return shareFile(file, name);
	}
	downloadFile({ file, name, type: file.type });
}
