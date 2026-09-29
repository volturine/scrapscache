import type { AppConfig, ModelRecord } from '@mlc-ai/web-llm';

/**
 * Keep @mlc-ai/web-llm pinned to 0.2.85 with the shape-tuple lifetime patch in
 * patches/ until that fix is included in an upstream release.
 *
 * The on-device models. Weights come from pinned Hugging Face commits and the
 * compiled WebGPU libraries from a pinned binary-mlc-llm-libs commit. A library
 * runs as code in this origin, so its hash is verified before it is loaded, as
 * are the config and tokenizer files. The library directory has to match the
 * `modelVersion` of the installed @mlc-ai/web-llm.
 */
const MODEL_LIB_BASE =
	'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base/';

const QWEN35_TOKENIZER = {
	'tokenizer.json': 'sha256-X55NSQGpK5l+RjwfRgVQiLbMpcphplItG59kxLuBy0I=',
	'vocab.json': 'sha256-zpm0yymD0RiAbOCot3ejWwk+IAClA+veJYUyhMnfoAM=',
	'merges.txt': 'sha256-qdNW173x70lJ4+dI6VuOEK2dTi6Djt3Digp7a5TR240='
};

const QWEN35_SMALL_TOKENIZER_CONFIG = 'sha256-SeK245X5WfB38emSsziRnA1KlzL8bmE5leBlV/hDUAw=';
const QWEN35_4B_TOKENIZER_CONFIG = 'sha256-MWIw1qgJcB9NteqPj8hivDpvMinJN8F05nT/PKCmSsg=';

function build(
	modelId: string,
	commit: string,
	vram: { MB: number; lowResource: boolean },
	integrity: { config: string; model_lib: string; tokenizer: Record<string, string> },
	overrides: ModelRecord['overrides'] = {}
): ModelRecord {
	return {
		model_id: modelId,
		model: `https://huggingface.co/mlc-ai/${modelId}/resolve/${commit}/`,
		model_lib: `${MODEL_LIB_BASE}${modelId.replace(/-MLC$/, '')}_cs1k-webgpu.wasm`,
		vram_required_MB: vram.MB,
		low_resource_required: vram.lowResource,
		...(modelId.includes('q4f16') ? { required_features: ['shader-f16'] } : {}),
		overrides: { context_window_size: 4096, ...overrides },
		integrity
	};
}

/**
 * One model the user can pick, in a half-precision build for GPUs with
 * shader-f16 and a full-precision one for the rest. All are Qwen3.5 models;
 * summaries run with thinking switched off.
 */
export interface LocalAiModel {
	name: string;
	/** Rounded download size of either build, shown before the user commits to it. */
	size: string;
	description: string;
	f16: ModelRecord;
	f32: ModelRecord;
}

export const LOCAL_AI_MODELS: readonly LocalAiModel[] = [
	{
		name: 'Qwen3.5 0.8B',
		size: '425 MB',
		description: 'Smallest and fastest. Recommended for phones and older devices.',
		f16: build(
			'Qwen3.5-0.8B-q4f16_1-MLC',
			'0ec138972555613c1d7812a821778ad0398c8790',
			{ MB: 1629.49, lowResource: true },
			{
				config: 'sha256-Hqk8K4s5ajdUUW0MS29LaIHCkwyizGyyzwDlEea+hqk=',
				model_lib: 'sha256-PdjP8Em/RZm/u1BYgK6hG6lfhfOSS34XH5Z9HxNIrik=',
				tokenizer: {
					...QWEN35_TOKENIZER,
					'tokenizer_config.json': QWEN35_SMALL_TOKENIZER_CONFIG
				}
			},
			{ max_history_size: 1 }
		),
		f32: build(
			'Qwen3.5-0.8B-q4f32_1-MLC',
			'4ed017713f04c91ffe55a9dca8c7ac853c41314d',
			{ MB: 1894.19, lowResource: true },
			{
				config: 'sha256-9d/M+tq7mYqa59Np1R5WEb3a5fTgGiv3yyRWc61YlHA=',
				model_lib: 'sha256-SCMuw7x1ZSFGPKm8Sf8DbYLqnHkw0qQe9tm/sg5caE0=',
				tokenizer: {
					...QWEN35_TOKENIZER,
					'tokenizer_config.json': QWEN35_SMALL_TOKENIZER_CONFIG
				}
			},
			{ max_history_size: 1 }
		)
	},
	{
		name: 'Qwen3.5 2B',
		size: '1.1 GB',
		description: 'More capable summaries. Needs up to 2.6 GB of GPU memory.',
		f16: build(
			'Qwen3.5-2B-q4f16_1-MLC',
			'dd74e9c8a20c4546df85c844103bff87b6dcacad',
			{ MB: 2245.44, lowResource: false },
			{
				config: 'sha256-Q1d7bemkxizw/pxe5XvFLrsvxIfGSiG/eNYkMRhrSwE=',
				model_lib: 'sha256-sPlR1BHk/Vn+Kvdr6TKJBa4wVJ5XChkqhByViyk+zVM=',
				tokenizer: {
					...QWEN35_TOKENIZER,
					'tokenizer_config.json': QWEN35_SMALL_TOKENIZER_CONFIG
				}
			},
			{ max_history_size: 1 }
		),
		f32: build(
			'Qwen3.5-2B-q4f32_1-MLC',
			'd835e5c41aa56174d915e8a3940cde599d3f5a30',
			{ MB: 2591.55, lowResource: false },
			{
				config: 'sha256-V7HcLkj2pHewv8gi6vNjNqQFvo/3t2BYySIoWpK3EQ8=',
				model_lib: 'sha256-D8czY635ucgfZSQhE4thvsI4oTh7Acj8z/2dPqRb6d0=',
				tokenizer: {
					...QWEN35_TOKENIZER,
					'tokenizer_config.json': QWEN35_SMALL_TOKENIZER_CONFIG
				}
			},
			{ max_history_size: 1 }
		)
	},
	{
		name: 'Qwen3.5 4B',
		size: '2.4 GB',
		description: 'Best summaries. Needs up to 4.7 GB of GPU memory.',
		f16: build(
			'Qwen3.5-4B-q4f16_1-MLC',
			'44b42469f9e192814bfd90440e3b377d89ba7a13',
			{ MB: 3867.82, lowResource: false },
			{
				config: 'sha256-uU1Tv95bSW2NliOb9GhOJLU5QgnlrvkSeGbvpFQ5VlE=',
				model_lib: 'sha256-fo+YldqnEKg5Uu+sTVxvNun4ncaEslAidG2IG9yQRxI=',
				tokenizer: {
					...QWEN35_TOKENIZER,
					'tokenizer_config.json': QWEN35_4B_TOKENIZER_CONFIG
				}
			},
			{ max_history_size: 1 }
		),
		f32: build(
			'Qwen3.5-4B-q4f32_1-MLC',
			'ce39652c7b493d59331e40ef9c7a87de5a47abe3',
			{ MB: 4680.36, lowResource: false },
			{
				config: 'sha256-DQc+M5Q6+yHmhIZfYscw4ByJT+m90isggi5L2b4oTi4=',
				model_lib: 'sha256-liYxo1zfCR7S1PIZnR6iL8O7nNAusEJuD9XaX9tTdc0=',
				tokenizer: {
					...QWEN35_TOKENIZER,
					'tokenizer_config.json': QWEN35_4B_TOKENIZER_CONFIG
				}
			},
			{ max_history_size: 1 }
		)
	}
];

export const LOCAL_AI_APP_CONFIG: AppConfig = {
	model_list: LOCAL_AI_MODELS.flatMap((model) => [model.f16, model.f32])
};

export function localAiBuildFor(
	model: LocalAiModel,
	features: { has(feature: string): boolean }
): ModelRecord {
	return features.has('shader-f16') ? model.f16 : model.f32;
}

/** The picker entry a downloaded build belongs to. */
export function localAiModelOf(modelId: string | null): LocalAiModel | undefined {
	return LOCAL_AI_MODELS.find(
		(model) => model.f16.model_id === modelId || model.f32.model_id === modelId
	);
}

export function isLocalAiModelId(id: string | null): id is string {
	return localAiModelOf(id) !== undefined;
}

/**
 * The reply without its reasoning block. With thinking switched off WebLLM
 * still emits an empty `<think></think>` first; while that block is still
 * streaming there is nothing to show yet.
 */
export function visibleReply(text: string): string {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith('<think>')) return text;
	const end = trimmed.indexOf('</think>');
	return end < 0 ? '' : trimmed.slice(end + '</think>'.length).trimStart();
}
