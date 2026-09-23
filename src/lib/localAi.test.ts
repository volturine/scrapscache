import { describe, expect, it } from 'vitest';
import { isValidSRI, modelVersion } from '@mlc-ai/web-llm';
import {
	isLocalAiModelId,
	LOCAL_AI_APP_CONFIG,
	LOCAL_AI_MODELS,
	localAiBuildFor,
	localAiModelOf,
	visibleReply
} from './localAi';

describe('local AI models', () => {
	it.each(LOCAL_AI_APP_CONFIG.model_list)('pins $model_id to fixed artifacts', (model) => {
		expect(model.model).toMatch(
			/^https:\/\/huggingface\.co\/mlc-ai\/[^/]+\/resolve\/[0-9a-f]{40}\/$/
		);
		expect(model.model_lib).toMatch(
			/^https:\/\/raw\.githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs\/[0-9a-f]{40}\//
		);
		// Model libraries are compiled for one WebLLM runtime version.
		expect(model.model_lib).toContain(`/web-llm-models/${modelVersion}/`);
		// The library is code that runs in this origin; every run checks its hash.
		expect(isValidSRI(model.integrity?.model_lib ?? '')).toBe(true);
		expect(isValidSRI(model.integrity?.config ?? '')).toBe(true);
		expect(isValidSRI(model.integrity?.tokenizer?.['tokenizer.json'] ?? '')).toBe(true);
		expect(isValidSRI(model.integrity?.tokenizer?.['tokenizer_config.json'] ?? '')).toBe(true);
		// Replies switch thinking off, which WebLLM supports for Qwen3-family models only.
		expect(model.model_id).toMatch(/^Qwen3/);
		expect(model.integrity?.onFailure ?? 'error').toBe('error');
	});

	it('gives every picker entry a half- and a full-precision build', () => {
		for (const model of LOCAL_AI_MODELS) {
			expect(model.f16.model_id).toMatch(/-q4f16_1-MLC$/);
			expect(model.f16.required_features).toEqual(['shader-f16']);
			expect(model.f32.model_id).toMatch(/-q4f32_1-MLC$/);
			expect(model.f32.required_features).toBeUndefined();
		}
		const ids = LOCAL_AI_APP_CONFIG.model_list.map((model) => model.model_id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('uses the half-precision build only where the GPU supports it', () => {
		const [model] = LOCAL_AI_MODELS;
		expect(localAiBuildFor(model, new Set(['shader-f16']))).toBe(model.f16);
		expect(localAiBuildFor(model, new Set())).toBe(model.f32);
	});

	it('maps a downloaded build back to its picker entry', () => {
		const model = LOCAL_AI_MODELS[2];
		expect(localAiModelOf(model.f16.model_id)).toBe(model);
		expect(localAiModelOf(model.f32.model_id)).toBe(model);
		expect(isLocalAiModelId('Llama-3.2-1B-Instruct-q4f16_1-MLC')).toBe(false);
		expect(isLocalAiModelId(null)).toBe(false);
	});
});

describe('visibleReply', () => {
	it('drops the empty reasoning block WebLLM emits with thinking off', () => {
		expect(visibleReply('<think>\n\n</think>\n\nPack the tent.')).toBe('Pack the tent.');
	});

	it('shows nothing while the reasoning block is still streaming', () => {
		expect(visibleReply('<think>\n')).toBe('');
		expect(visibleReply('<thi')).toBe('<thi');
	});

	it('leaves a reply without a reasoning block alone', () => {
		expect(visibleReply('Pack the tent.')).toBe('Pack the tent.');
	});
});
