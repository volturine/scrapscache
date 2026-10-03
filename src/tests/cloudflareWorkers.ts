// `cloudflare:workers` for tests: no bindings and no request lifetime to extend.
export const env: Record<string, unknown> = {};

export function waitUntil(promise: Promise<unknown>): void {
	void promise.catch(() => undefined);
}
