import { defineConfig } from '@pandacss/dev';
import { recipes, slotRecipes } from './panda/recipes';
import { theme } from './panda/theme';

export default defineConfig({
	presets: ['@pandacss/preset-base', '@pandacss/preset-panda'],
	preflight: true,
	globalCss: {
		body: {
			bg: 'scrapscache.bg',
			color: 'scrapscache.text',
			fontFamily: 'sans',
			textStyle: 'body',
			WebkitFontSmoothing: 'antialiased',
			MozOsxFontSmoothing: 'grayscale'
		}
	},
	include: ['./src/**/*.{js,jsx,ts,tsx,svelte}', './panda/styles.ts'],
	exclude: [],
	staticCss: {
		recipes: {
			// These values are selected from persisted or reactive state and need all generated variants.
			noteSurface: ['*'],
			noteCard: ['*'],
			checklist: ['*'],
			noteBody: ['*']
		}
	},
	conditions: {
		extend: {
			dark: '&:where(.dark, .dark *)',
			hoverable: {
				'@media (hover: hover) and (pointer: fine)': {
					'&:hover': '@slot'
				}
			},
			touch: '@media (pointer: coarse)'
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
