import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const sourceRoot = join(root, 'src');
const sourceExtensions = new Set(['.html', '.js', '.svelte', '.ts']);
const sourceFiles = walk(sourceRoot).filter((file) => sourceExtensions.has(extname(file)));
const configFile = join(root, 'panda.config.ts');
const globalStylesheet = join(root, 'src/app.css');
const config = readFileSync(configFile, 'utf8');
const authoredStyles = [...sourceFiles, configFile];
const componentStyles = sourceFiles.filter(
	(file) => !file.endsWith('.test.ts') && (file.endsWith('.svelte') || file.endsWith('Styles.ts'))
);
const failures = [];

checkFiles(
	sourceFiles,
	/\b_dark\s*:/g,
	'Use a semantic token instead of a component-level light/dark pair.'
);
checkFiles(authoredStyles, /\b_hover\s*:/g, 'Use the _hoverable condition for hover feedback.');
checkFiles(
	authoredStyles,
	/transition\s*:\s*['"]all\b/g,
	'List the transitioned properties instead of using transition: all.'
);
checkFiles(
	sourceFiles,
	/\bconst\s+\w+\s*=\s*css\s*\(/g,
	'Keep one-off css() declarations at the use site instead of naming a wrapper class.'
);
checkFiles(
	componentStyles,
	/\b(?:background|bg|borderColor|color|fill|outlineColor|ringColor|stroke)\s*:\s*['"](?:black|white|red|rose|amber|blue|green|emerald)(?:[.'"/])/g,
	'Use a semantic color token instead of a raw palette color.'
);
checkFiles(
	componentStyles,
	/\bboxShadow\s*:\s*['"][^'"]*(?:#|rgba?\()/g,
	'Use a shadow token instead of a raw shadow value.'
);
checkFiles(
	sourceFiles.filter((file) => file.endsWith('.svelte')),
	/\bclass="[^"]*\{/g,
	'Use a class array for dynamic class composition.'
);
checkFiles(
	[...sourceFiles, configFile],
	/--scrapscache-/g,
	'Use Panda semantic tokens instead of parallel --scrapscache-* custom properties.'
);
checkFiles(
	[globalStylesheet],
	/\.dark\s+\./g,
	'Global components must consume semantic tokens instead of maintaining .dark overrides.'
);

const recipeSection = config.slice(0, config.indexOf('semanticTokens:'));
checkText(
	configFile,
	recipeSection,
	/\b_dark\s*:/g,
	'Recipes must consume semantic tokens, not light/dark pairs.'
);
checkText(
	configFile,
	recipeSection,
	/\b(?:background|bg|borderColor|color|fill|outlineColor|ringColor|stroke)\s*:\s*['"](?:black|white|red|rose|amber|blue|green|emerald)(?:[.'"/])/g,
	'Recipes must consume semantic color tokens instead of raw palette colors.'
);
checkText(
	configFile,
	recipeSection,
	/\bboxShadow\s*:\s*['"][^'"]*(?:#|rgba?\()/g,
	'Recipes must consume shadow tokens instead of raw shadow values.'
);

const allowedGlobalClasses = new Set([
	'App-bottom-bar',
	'App-toolbar-content',
	'Dialog--fullscreen',
	'Modal',
	'Modal__background',
	'Modal__content',
	'app-canvas',
	'app-feed',
	'app-float',
	'app-overlay',
	'app-shell',
	'app-viewport',
	'confirm-dialog',
	'dark',
	'dropdown-menu--mobile',
	'editor-caret-hidden',
	'editor-open',
	'excalidraw',
	'excalidraw-modal-container',
	'keyboard-open',
	'kanban-card',
	'kanban-columns',
	'kanban-dragging',
	'kanban-dragging-touch',
	'new-note-fab',
	'note-scrollbar-hidden',
	'reminder-calendar',
	'scrapscache-canvas',
	'scrapscache-sync-active',
	'scrapscache-sync-icon-active',
	'scrollable'
]);

const globalCss = readFileSync(globalStylesheet, 'utf8');
for (const match of globalCss.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
	if (!allowedGlobalClasses.has(match[1])) {
		addFailure(
			globalStylesheet,
			globalCss,
			match.index,
			`Global class "${match[1]}" is not an approved document-state or third-party hook; use Panda for component styling.`
		);
	}
}

for (const file of sourceFiles.filter((candidate) => extname(candidate) === '.svelte')) {
	const contents = readFileSync(file, 'utf8');
	for (const match of contents.matchAll(/\bclass="([^"{}]*)"/g)) {
		for (const className of match[1].trim().split(/\s+/).filter(Boolean)) {
			if (!allowedGlobalClasses.has(className)) {
				addFailure(
					file,
					contents,
					match.index,
					`Static class "${className}" is not an approved behavior hook; use Panda for styling.`
				);
			}
		}
	}
}

if (failures.length > 0) {
	console.error(
		`Style policy failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):`
	);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(`Style policy passed (${sourceFiles.length} source files checked).`);

function walk(directory) {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

function checkFiles(files, pattern, message) {
	for (const file of files) checkText(file, readFileSync(file, 'utf8'), pattern, message);
}

function checkText(file, contents, pattern, message) {
	for (const match of contents.matchAll(pattern)) addFailure(file, contents, match.index, message);
}

function addFailure(file, contents, index, message) {
	const line = contents.slice(0, index).split('\n').length;
	failures.push(`${relative(root, file)}:${line} ${message}`);
}
