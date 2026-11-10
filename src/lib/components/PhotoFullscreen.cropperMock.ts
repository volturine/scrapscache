/** API used by the cropper snippet in PhotoFullscreen component tests. */
export const cropperHarness: Record<string, unknown> = {
	getCroppedImage: async () => 'data:image/webp;base64,YWJj',
	rotateBy: () => {},
	reset: () => {},
	setRotation: () => {}
};
