// The engine library is several megabytes, so it is imported only once a
// download or summary starts, never with the app shell.
import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import {
	isLocalAiModelId,
	LOCAL_AI_APP_CONFIG,
	localAiBuildFor,
	localAiModelOf,
	SUMMARY_MAX_TOKENS,
	summaryMessages,
	visibleReply,
	type LocalAiModel
} from '$lib/localAi';

/** Device-wide: the model lives in this origin's Cache Storage, shared by every workspace. */
const STORAGE_KEY = 'scrapscache.localAiModel';
/** Cache Storage buckets WebLLM writes with its default "cache" backend. */
const WEBLLM_CACHES = ['webllm/model', 'webllm/config', 'webllm/wasm'];

export enum LocalAiStatus {
	Unsupported = 'unsupported',
	Absent = 'absent',
	Downloading = 'downloading',
	Ready = 'ready'
}

export class LocalAiStore {
	status = $state(LocalAiStatus.Unsupported);
	/** 0–1 while the model downloads or loads into the GPU. */
	progress = $state(0);
	loading = $state(false);
	error = $state('');

	#modelId = $state<string | null>(null);
	#worker: Worker | null = null;
	#engine: Promise<WebWorkerMLCEngine> | null = null;
	/** Bumped by cancel and remove so a superseded download cannot finish into the store. */
	#run = 0;
	#stopped = false;

	constructor() {
		if (typeof navigator === 'undefined' || !('gpu' in navigator)) return;
		const saved = localStorage.getItem(STORAGE_KEY);
		this.#modelId = isLocalAiModelId(saved) ? saved : null;
		this.status = this.#modelId ? LocalAiStatus.Ready : LocalAiStatus.Absent;
	}

	/** The picked model while it downloads or once it is on this device. */
	get model(): LocalAiModel | undefined {
		return localAiModelOf(this.#modelId);
	}

	async download(model: LocalAiModel) {
		if (this.status !== LocalAiStatus.Absent) return;
		const run = ++this.#run;
		this.error = '';
		this.progress = 0;
		this.status = LocalAiStatus.Downloading;
		try {
			const adapter = await navigator.gpu.requestAdapter();
			if (!adapter) throw new Error('No usable GPU');
			const modelId = localAiBuildFor(model, adapter.features).model_id;
			this.#modelId = modelId;
			await this.#load(modelId);
			if (run !== this.#run) return;
			localStorage.setItem(STORAGE_KEY, modelId);
			this.status = LocalAiStatus.Ready;
		} catch (err) {
			if (run !== this.#run) return;
			console.error('[localAi] download failed:', err);
			await this.#discard();
			this.error = 'Setup failed. Check your connection, or pick a smaller model.';
		}
	}

	cancel() {
		if (this.status !== LocalAiStatus.Downloading) return;
		void this.#discard();
	}

	remove() {
		if (this.status !== LocalAiStatus.Ready) return;
		void this.#discard();
	}

	/** Streams a summary of the note into `onText`, which receives the full text so far. */
	async summarize(title: string, body: string, onText: (text: string) => void): Promise<string> {
		const modelId = this.#modelId;
		if (this.status !== LocalAiStatus.Ready || !modelId) throw new Error('Local AI is not set up.');
		let engine: WebWorkerMLCEngine;
		this.#stopped = false;
		this.loading = true;
		try {
			if (!this.#engine) {
				const { hasModelInCache } = await import('@mlc-ai/web-llm');
				if (!(await hasModelInCache(modelId, LOCAL_AI_APP_CONFIG))) {
					await this.#discard();
					throw new Error('The model is no longer in the browser cache.');
				}
			}
			this.progress = 0;
			engine = await this.#load(modelId);
		} finally {
			this.loading = false;
		}
		if (this.#stopped) return '';
		const stream = await engine.chat.completions.create({
			messages: summaryMessages(title, body),
			stream: true,
			temperature: 0.2,
			max_tokens: SUMMARY_MAX_TOKENS,
			// Every picker model is a Qwen3-family reasoning model; a summary needs no reasoning.
			extra_body: { enable_thinking: false }
		});
		let text = '';
		for await (const chunk of stream) {
			text += chunk.choices[0]?.delta.content ?? '';
			onText(visibleReply(text));
		}
		return visibleReply(text).trim();
	}

	/** Ends the reply early; `summarize` then resolves with what it has so far. */
	stop() {
		this.#stopped = true;
		void this.#engine?.then((engine) => engine.interruptGenerate());
	}

	#load(modelId: string): Promise<WebWorkerMLCEngine> {
		if (this.#engine) return this.#engine;
		const worker = new Worker(new URL('../localAi.worker.ts', import.meta.url), {
			type: 'module'
		});
		const engine = import('@mlc-ai/web-llm').then(({ CreateWebWorkerMLCEngine }) =>
			CreateWebWorkerMLCEngine(worker, modelId, {
				appConfig: LOCAL_AI_APP_CONFIG,
				initProgressCallback: (report) => {
					this.progress = report.progress;
				}
			})
		);
		this.#worker = worker;
		this.#engine = engine;
		engine.catch(() => {
			if (this.#engine === engine) this.#unload();
		});
		return engine;
	}

	#unload() {
		this.#worker?.terminate();
		this.#worker = null;
		this.#engine = null;
	}

	/** Stops the engine and deletes every cached model file, finished or partial. */
	async #discard() {
		this.#run++;
		this.#unload();
		const modelId = this.#modelId;
		this.#modelId = null;
		localStorage.removeItem(STORAGE_KEY);
		this.status = LocalAiStatus.Absent;
		this.progress = 0;
		if (!modelId) return;
		try {
			// WebLLM's own deleteModelAllInfoInCache leaves tokenizer_config.json
			// behind. These caches hold nothing but this feature's files.
			await Promise.all(WEBLLM_CACHES.map((name) => caches.delete(name)));
		} catch (err) {
			console.error('[localAi] could not delete the cached model:', err);
		}
	}
}

export const localAiStore = new LocalAiStore();
