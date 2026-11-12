// browser-fs-access ships its types, but its package exports do not name them,
// so TypeScript finds none. These are the parts Excalidraw uses.
declare module 'browser-fs-access' {
	export type FileSaveOptions = {
		fileName?: string;
		extensions?: string[];
		description?: string;
		mimeTypes?: string[];
	};
	export const supported: boolean;
	export function fileOpen(options?: object | object[]): Promise<File | File[]>;
	export function fileSave(
		data: Blob | Promise<Blob> | Response,
		options?: FileSaveOptions | [FileSaveOptions, ...object[]]
	): Promise<FileSystemFileHandle | null>;
}
