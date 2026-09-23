import type { AppConfig, ModelRecord } from '@mlc-ai/web-llm';

/**
 * The on-device models. Weights come from pinned Hugging Face commits and the
 * compiled WebGPU libraries from a pinned binary-mlc-llm-libs commit. A library
 * runs as code in this origin, so its hash is verified before it is loaded, as
 * are the config and tokenizer files. The library directory has to match the
 * `modelVersion` of the installed @mlc-ai/web-llm.
 */
const MODEL_LIB_BASE =
	'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base/';

const QWEN3_TOKENIZER = {
	'tokenizer.json': 'sha256-rrEzB6cazY/oGGHZStVKtonfdzMYgJ7tPL55S0SS2uQ=',
	'vocab.json': 'sha256-yhDX6fs+0YV13R4neiV5wW0QjjLydDloSvoOELFECRA=',
	'merges.txt': 'sha256-iDHk8aBERxNA98CoPXvXEwaluGfpX9hw900MUwipBNU='
};

const QWEN35_TOKENIZER = {
	'tokenizer.json': 'sha256-X55NSQGpK5l+RjwfRgVQiLbMpcphplItG59kxLuBy0I=',
	'vocab.json': 'sha256-zpm0yymD0RiAbOCot3ejWwk+IAClA+veJYUyhMnfoAM=',
	'merges.txt': 'sha256-qdNW173x70lJ4+dI6VuOEK2dTi6Djt3Digp7a5TR240=',
	'tokenizer_config.json': 'sha256-MWIw1qgJcB9NteqPj8hivDpvMinJN8F05nT/PKCmSsg='
};

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
 * shader-f16 and a full-precision one for the rest. All are Qwen3-family
 * hybrid reasoning models; summaries run with thinking switched off.
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
		name: 'Qwen3 1.7B',
		size: '1 GB',
		description: 'Accurate summaries in most languages. Runs on most laptops.',
		f16: build(
			'Qwen3-1.7B-q4f16_1-MLC',
			'80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc',
			{ MB: 2036.66, lowResource: true },
			{
				config: 'sha256-9ecmtQNj/6roPwY61A3bZzlOfaCQ0lHPVJpp1fiZ1Yo=',
				model_lib: 'sha256-gWGqpLQLzPGfztsvLowiHrnvty0hmGgfGVjJweBaaC8=',
				tokenizer: {
					...QWEN3_TOKENIZER,
					'tokenizer_config.json': 'sha256-WnMD/LGift5jE0osvWHVKCwkfKbXac5HRtT/oSSu3WM='
				}
			}
		),
		f32: build(
			'Qwen3-1.7B-q4f32_1-MLC',
			'bddd4d584cabe19113f7e4ff46fd9e73b4d3dc89',
			{ MB: 2635.44, lowResource: true },
			{
				config: 'sha256-8zsy82cfjzivLUXJwSXXSa/qqrhi0uYClW/t9bYPJXs=',
				model_lib: 'sha256-qAyg0kXtnOSSSXkYr9IewdQ904c7Y1kSVbAb2cQa32U=',
				tokenizer: {
					...QWEN3_TOKENIZER,
					'tokenizer_config.json': 'sha256-WnMD/LGift5jE0osvWHVKCwkfKbXac5HRtT/oSSu3WM='
				}
			}
		)
	},
	{
		name: 'Qwen3 0.6B',
		size: '350 MB',
		description: 'Smallest and fastest. For phones and older devices.',
		f16: build(
			'Qwen3-0.6B-q4f16_1-MLC',
			'8c14ce481d4c692769976ad52afea453a102df19',
			{ MB: 1403.34, lowResource: true },
			{
				config: 'sha256-GQpRxWuaB6jYchJm+ORZvNGxaJvN/ylHlc0r/6ID/y0=',
				model_lib: 'sha256-TbgAskEZIE4aA4booS4ITVASqmD3fFv/rTYvIEmN+RI=',
				tokenizer: {
					...QWEN3_TOKENIZER,
					'tokenizer_config.json': 'sha256-u8LAieO++HU/YzSMEFlXZ76JmLxsp8fryq2jRtQB+6g='
				}
			}
		),
		f32: build(
			'Qwen3-0.6B-q4f32_1-MLC',
			'9b4f0b05b08c692ea86fe151ea878406ad22f428',
			{ MB: 1924.98, lowResource: true },
			{
				config: 'sha256-5S/NMvOOqp2Ihv0+ng8PEzNCJnhKn9j02yrP//AWU88=',
				model_lib: 'sha256-Nh8TEK5haGO8y8Y48HX3SEgWtF6zD/7PCFOScqGyrh4=',
				tokenizer: {
					...QWEN3_TOKENIZER,
					'tokenizer_config.json': 'sha256-u8LAieO++HU/YzSMEFlXZ76JmLxsp8fryq2jRtQB+6g='
				}
			}
		)
	},
	{
		name: 'Qwen3.5 4B',
		size: '2.4 GB',
		description: 'Best summaries. Needs a recent GPU with 4 GB of memory.',
		f16: build(
			'Qwen3.5-4B-q4f16_1-MLC',
			'44b42469f9e192814bfd90440e3b377d89ba7a13',
			{ MB: 3867.82, lowResource: false },
			{
				config: 'sha256-uU1Tv95bSW2NliOb9GhOJLU5QgnlrvkSeGbvpFQ5VlE=',
				model_lib: 'sha256-fo+YldqnEKg5Uu+sTVxvNun4ncaEslAidG2IG9yQRxI=',
				tokenizer: QWEN35_TOKENIZER
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
				tokenizer: QWEN35_TOKENIZER
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
