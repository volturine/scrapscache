// The engine library is several megabytes, so it is imported only once a
// download or a reply starts, never with the app shell.
import type { ChatCompletionMessageParam, WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import {
	isLocalAiModelId,
	LOCAL_AI_APP_CONFIG,
	localAiBuildFor,
	localAiModelOf,
	visibleReply,
	type LocalAiModel
} from '$lib/localAi';

/** Device-wide: the model lives in this origin's Cache Storage, shared by every workspace. */
const STORAGE_KEY = 'scrapscache.localAiModel';
const ENABLED_STORAGE_KEY = 'scrapscache.localAiEnabled';
/** Cache Storage buckets WebLLM writes with its default "cache" backend. */
const WEBLLM_CACHES = ['webllm/model', 'webllm/config', 'webllm/wasm'];

export enum LocalAiStatus {
	Unsupported = 'unsupported',
	Absent = 'absent',
	Downloading = 'downloading',
	Ready = 'ready'
}

export class LocalAiStore {
	enabled = $state(true);
	status = $state(LocalAiStatus.Unsupported);
	/** 0–1 while the model downloads or loads into the GPU. */
	progress = $state(0);
	loading = $state(false);
	error = $state('');

	#modelId = $state<string | null>(null);
	#worker: Worker | null = null;
	#engine: Promise<WebWorkerMLCEngine> | null = null;
	#engineInstance: WebWorkerMLCEngine | null = null;
	/** Bumped by cancel and remove so a superseded download cannot finish into the store. */
	#run = 0;
	#generation = 0;
	#activeGeneration = 0;

	#onStorage = (event: StorageEvent) => {
		if (event.key === ENABLED_STORAGE_KEY) this.#applyEnabled(event.newValue !== 'false');
	};

	constructor() {
		if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
		this.enabled = localStorage.getItem(ENABLED_STORAGE_KEY) !== 'false';
		window.addEventListener('storage', this.#onStorage);
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved !== null && !isLocalAiModelId(saved)) {
			localStorage.removeItem(STORAGE_KEY);
			void Promise.resolve()
				.then(() => Promise.all(WEBLLM_CACHES.map((name) => caches.delete(name))))
				.catch((err) => {
					console.error('[localAi] could not delete the unsupported cached model:', err);
				});
		}
		if (!navigator.gpu) return;
		this.#modelId = isLocalAiModelId(saved) ? saved : null;
		this.status = this.#modelId ? LocalAiStatus.Ready : LocalAiStatus.Absent;
	}

	setEnabled(enabled: boolean) {
		if (this.enabled === enabled) return;
		localStorage.setItem(ENABLED_STORAGE_KEY, String(enabled));
		this.#applyEnabled(enabled);
	}

	#applyEnabled(enabled: boolean) {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		if (!enabled) {
			this.stop();
			if (this.status === LocalAiStatus.Downloading) this.cancel();
		}
	}

	/** The picked model while it downloads or once it is on this device. */
	get model(): LocalAiModel | undefined {
		return localAiModelOf(this.#modelId);
	}

	async download(model: LocalAiModel) {
		if (!this.enabled || this.status !== LocalAiStatus.Absent) return;
		const run = ++this.#run;
		this.error = '';
		this.progress = 0;
		this.status = LocalAiStatus.Downloading;
		try {
			if (!navigator.gpu) throw new Error('WebGPU is unavailable');
			const adapter = await navigator.gpu.requestAdapter();
			if (run !== this.#run || !this.enabled) return;
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

	/** Streams a reply into `onText`, which receives the full visible text so far. */
	async generate(
		messages: ChatCompletionMessageParam[],
		maxTokens: number,
		onText: (text: string) => void
	): Promise<string> {
		const modelId = this.#modelId;
		if (!this.enabled) throw new Error('Local AI is disabled for this browser.');
		if (this.status !== LocalAiStatus.Ready || !modelId) throw new Error('Local AI is not set up.');
		if (this.#activeGeneration) this.#engineInstance?.interruptGenerate();
		const generation = ++this.#generation;
		this.#activeGeneration = generation;
		this.loading = true;
		try {
			let engine: WebWorkerMLCEngine;
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
				if (this.#activeGeneration === generation) this.loading = false;
			}
			if (generation !== this.#generation) return '';
			const stream = await engine.chat.completions.create({
				messages,
				stream: true,
				temperature: 0.2,
				max_tokens: maxTokens,
				// Every picker model is a Qwen3-family reasoning model; note edits need no reasoning.
				extra_body: { enable_thinking: false }
			});
			let text = '';
			for await (const chunk of stream) {
				if (generation !== this.#generation) break;
				text += chunk.choices[0]?.delta.content ?? '';
				onText(visibleReply(text));
			}
			return visibleReply(text).trim();
		} finally {
			if (this.#activeGeneration === generation) this.#activeGeneration = 0;
		}
	}

	/** Ends the reply early; `generate` then resolves with what it has so far. */
	stop() {
		if (!this.#activeGeneration) return;
		this.#generation++;
		this.#activeGeneration = 0;
		this.loading = false;
		this.#engineInstance?.interruptGenerate();
	}

	#load(modelId: string): Promise<WebWorkerMLCEngine> {
		if (this.#engine) return this.#engine;
		const worker = new Worker(new URL('../localAi.worker.ts', import.meta.url), {
			type: 'module'
		});
		let engine: Promise<WebWorkerMLCEngine>;
		engine = import('@mlc-ai/web-llm')
			.then(({ CreateWebWorkerMLCEngine }) =>
				CreateWebWorkerMLCEngine(worker, modelId, {
					appConfig: LOCAL_AI_APP_CONFIG,
					initProgressCallback: (report) => {
						this.progress = report.progress;
					}
				})
			)
			.then((instance) => {
				if (this.#engine === engine) this.#engineInstance = instance;
				return instance;
			});
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
		this.#engineInstance = null;
	}

	/** Stops the engine and deletes every cached model file, finished or partial. */
	async #discard() {
		this.#run++;
		this.#generation++;
		this.#activeGeneration = 0;
		this.loading = false;
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
