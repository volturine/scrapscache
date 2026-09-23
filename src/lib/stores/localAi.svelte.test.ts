import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_AI_MODELS } from '$lib/localAi';

const [SMALL, , LARGE] = LOCAL_AI_MODELS;

const webllm = vi.hoisted(() => ({
	CreateWebWorkerMLCEngine: vi.fn(),
	hasModelInCache: vi.fn()
}));
vi.mock('@mlc-ai/web-llm', () => webllm);

const { LocalAiStore, LocalAiStatus } = await import('./localAi.svelte');

const STORAGE_KEY = 'scrapscache.localAiModel';
const MESSAGES = [{ role: 'user' as const, content: 'Pack socks' }];
const terminate = vi.fn();
const deleteCache = vi.fn(async (_name: string) => true);
const WEBLLM_CACHES = ['webllm/model', 'webllm/config', 'webllm/wasm'];

function stubGpu(features: string[] = ['shader-f16']) {
	vi.stubGlobal('navigator', {
		...navigator,
		gpu: { requestAdapter: vi.fn(async () => ({ features: new Set(features) })) }
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function fakeEngine(chunks: string[] = []) {
	return {
		interruptGenerate: vi.fn(),
		chat: {
			completions: {
				create: vi.fn(async () =>
					(async function* () {
						for (const content of chunks) yield { choices: [{ delta: { content } }] };
					})()
				)
			}
		}
	};
}

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal(
		'Worker',
		class {
			terminate = terminate;
		}
	);
	vi.stubGlobal('caches', { delete: deleteCache });
	webllm.hasModelInCache.mockResolvedValue(true);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('LocalAiStore', () => {
	it('is unsupported without WebGPU', () => {
		expect(new LocalAiStore().status).toBe(LocalAiStatus.Unsupported);
	});

	it('restores a finished download and ignores unknown model ids', () => {
		stubGpu();
		localStorage.setItem(STORAGE_KEY, SMALL.f32.model_id);
		const restored = new LocalAiStore();
		expect(restored.status).toBe(LocalAiStatus.Ready);
		expect(restored.model).toBe(SMALL);
		localStorage.setItem(STORAGE_KEY, 'some-other-model');
		expect(new LocalAiStore().status).toBe(LocalAiStatus.Absent);
	});

	it('downloads the picked model in the build the GPU supports and remembers it', async () => {
		stubGpu([]);
		webllm.CreateWebWorkerMLCEngine.mockImplementation(async (_worker, _id, config) => {
			config.initProgressCallback({ progress: 0.5, timeElapsed: 1, text: '' });
			return fakeEngine();
		});
		const store = new LocalAiStore();
		await store.download(LARGE);
		expect(webllm.CreateWebWorkerMLCEngine.mock.calls[0][1]).toBe(LARGE.f32.model_id);
		expect(store.status).toBe(LocalAiStatus.Ready);
		expect(store.model).toBe(LARGE);
		expect(store.progress).toBe(0.5);
		expect(localStorage.getItem(STORAGE_KEY)).toBe(LARGE.f32.model_id);
	});

	it('deletes partial files when a download fails', async () => {
		stubGpu();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		webllm.CreateWebWorkerMLCEngine.mockRejectedValue(new Error('network'));
		const store = new LocalAiStore();
		await store.download(SMALL);
		expect(store.status).toBe(LocalAiStatus.Absent);
		expect(store.error).toMatch(/Setup failed/);
		expect(terminate).toHaveBeenCalled();
		expect(deleteCache.mock.calls.map(([name]) => name)).toEqual(WEBLLM_CACHES);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('does not let a cancelled download finish into the store', async () => {
		stubGpu();
		const load = deferred<ReturnType<typeof fakeEngine>>();
		webllm.CreateWebWorkerMLCEngine.mockReturnValue(load.promise);
		const store = new LocalAiStore();
		const download = store.download(SMALL);
		await vi.waitFor(() => expect(webllm.CreateWebWorkerMLCEngine).toHaveBeenCalled());
		expect(store.model).toBe(SMALL);
		store.cancel();
		expect(store.status).toBe(LocalAiStatus.Absent);
		expect(store.model).toBeUndefined();
		load.resolve(fakeEngine());
		await download;
		expect(store.status).toBe(LocalAiStatus.Absent);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		expect(terminate).toHaveBeenCalled();
		await vi.waitFor(() =>
			expect(deleteCache.mock.calls.map(([name]) => name)).toEqual(WEBLLM_CACHES)
		);
	});

	it('removes a downloaded model', async () => {
		stubGpu();
		localStorage.setItem(STORAGE_KEY, SMALL.f16.model_id);
		const store = new LocalAiStore();
		store.remove();
		expect(store.status).toBe(LocalAiStatus.Absent);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
		await vi.waitFor(() => expect(deleteCache).toHaveBeenCalledTimes(3));
	});

	it('streams a reply from the cached model', async () => {
		stubGpu();
		localStorage.setItem(STORAGE_KEY, SMALL.f16.model_id);
		const engine = fakeEngine(['<think>\n\n</think>\n\n', 'Pack ', 'socks. ']);
		webllm.CreateWebWorkerMLCEngine.mockResolvedValue(engine);
		const store = new LocalAiStore();
		const seen: string[] = [];
		await expect(store.generate(MESSAGES, 64, (text) => seen.push(text))).resolves.toBe(
			'Pack socks.'
		);
		expect(seen).toEqual(['', 'Pack ', 'Pack socks. ']);
		expect(engine.chat.completions.create).toHaveBeenCalledWith(
			expect.objectContaining({
				stream: true,
				messages: MESSAGES,
				max_tokens: 64,
				extra_body: { enable_thinking: false }
			})
		);
		expect(store.loading).toBe(false);
	});

	it('never starts a download from a reply when the browser evicted the model', async () => {
		stubGpu();
		localStorage.setItem(STORAGE_KEY, SMALL.f16.model_id);
		webllm.hasModelInCache.mockResolvedValue(false);
		const store = new LocalAiStore();
		await expect(store.generate(MESSAGES, 64, () => {})).rejects.toThrow();
		expect(webllm.CreateWebWorkerMLCEngine).not.toHaveBeenCalled();
		expect(store.status).toBe(LocalAiStatus.Absent);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('skips generation when stopped while the model loads', async () => {
		stubGpu();
		localStorage.setItem(STORAGE_KEY, SMALL.f16.model_id);
		const engine = fakeEngine(['text']);
		const load = deferred<typeof engine>();
		webllm.CreateWebWorkerMLCEngine.mockReturnValue(load.promise);
		const store = new LocalAiStore();
		const summary = store.generate(MESSAGES, 64, () => {});
		await vi.waitFor(() => expect(webllm.CreateWebWorkerMLCEngine).toHaveBeenCalled());
		store.stop();
		load.resolve(engine);
		await expect(summary).resolves.toBe('');
		expect(engine.chat.completions.create).not.toHaveBeenCalled();
	});
});
