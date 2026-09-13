import { defineConfig } from '@pandacss/dev';
import { recipes, slotRecipes } from './panda/recipes';
import { theme } from './panda/theme';

export default defineConfig({
	preflight: true,
	include: ['./src/**/*.{js,jsx,ts,tsx,svelte}'],
	exclude: [],
	staticCss: {
		recipes: {
			// Note colors are selected from persisted data and need all generated variants.
			noteSurface: ['*'],
			checklist: ['*'],
			noteBody: ['*']
		}
	},
	conditions: {
		extend: {
			dark: '&:where(.dark, .dark *)',
			hoverable: ['@media (hover: hover) and (pointer: fine)', '&:hover']
		}
	},
	theme: {
		extend: {
			...theme.extend,
			recipes,
			slotRecipes
		}
	},
	outdir: 'styled-system'
});
