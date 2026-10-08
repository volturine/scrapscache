/** True on macOS and iOS, where text shortcuts use Cmd instead of Ctrl. */
export function isApplePlatform(): boolean {
	if (typeof navigator === 'undefined') return false;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}
