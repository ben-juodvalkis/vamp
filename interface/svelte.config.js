import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Using adapter-auto for automatic adapter selection (works with PWA plugin)
		adapter: adapter(),
		alias: {
			// `$config` resolves to repo-root `config/` so deep components
			// can `import constants from '$config/constants.json'` instead
			// of climbing six levels of `../`. Code-quality audit follow-up.
			$config: '../config'
		},
		// The pre-push gate (scripts/gate.sh) runs svelte-check, vitest and
		// the build at once. Each process rewrites every generated file in
		// its outDir when it starts (SvelteKit's write-if-changed cache is
		// per process), so sharing one folder would let one read a file
		// another has just truncated. The gate syncs the default folder
		// once, then gives each its own under `.svelte-kit/`. Everything
		// else uses the default, which `interface/tsconfig.json` extends.
		outDir: process.env.LOOPING_KIT_OUT_DIR || '.svelte-kit'
	}
};

export default config;
