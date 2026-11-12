// What Excalidraw loads as `browser-fs-access` in the iPhone app (vite.config.ts
// swaps it in for that build alone). The package saves a file through a download
// link, which the app's web view drops without a word, so a save goes to iOS's
// share sheet here. Opening a file is the package's own: a file input, which the
// web view does show.
import type { fileSave as packageFileSave } from 'browser-fs-access';
import { shareFile } from './shareFile.js';

export { fileOpen, supported } from 'browser-fs-access';

/**
 * Hand the file to the share sheet under the name it was to be saved by. There
 * is no file to save to again, so the handle is null, as it is in a browser
 * without file handles. A sheet closed without a choice is an aborted save,
 * which is how a closed file dialog reads to the caller.
 */
export const fileSave: typeof packageFileSave = async (data, options = {}) => {
	const { fileName = 'Untitled' } = Array.isArray(options) ? options[0] : options;
	const file = await data;
	const saved = await shareFile(file instanceof Blob ? file : await file.blob(), fileName);
	if (!saved) throw new DOMException('The file was not saved.', 'AbortError');
	return null;
};
