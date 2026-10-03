// Test doubles for `$app/env/private` and `$app/env/public`. Tests assign raw
// values; reads go through the schemas in `src/env.ts`, as SvelteKit's would, and
// `setup.ts` clears both after every test.
import { variables } from '../env';

export const privateEnv: Record<string, string | undefined> = {};
export const publicEnv: Record<string, string | undefined> = {};

export function envModule(isPublic: boolean): Record<string, unknown> {
	const values = isPublic ? publicEnv : privateEnv;
	const module: Record<string, unknown> = {};
	for (const [name, config] of Object.entries(variables)) {
		if (Boolean(config.public) !== isPublic) continue;
		Object.defineProperty(module, name, {
			enumerable: true,
			get: () => {
				const result = config.schema['~standard'].validate(values[name]);
				if (result instanceof Promise || result.issues) throw new Error(`Invalid ${name}`);
				return result.value;
			}
		});
	}
	return module;
}

export function resetEnv(): void {
	for (const values of [privateEnv, publicEnv])
		for (const name of Object.keys(values)) delete values[name];
}
