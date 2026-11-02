import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * The demo's static output: the client bundle and a fallback page that boots
 * it on any path. What adapter-static does in SPA mode, without the
 * dependency.
 *
 * @param {string} out
 * @returns {import('@sveltejs/kit').Adapter}
 */
const demoAdapter = (out) => ({
	name: 'vamp-demo',
	async adapt(builder) {
		builder.rimraf(out);
		builder.writeClient(out);
		builder.writePrerendered(out);
		await builder.generateFallback(`${out}/index.html`);
	}
});

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// A checkout serves the build with `vite preview` (npm run ipad), which
		// reads `.svelte-kit/output` itself, so no adapter output is needed.
		// This one writes nothing. adapter-auto warned on every build that it
		// found no platform, which read as a failure to anyone starting Vamp.
		// The installed app's standalone server (`scripts/build-server.mjs`,
		// installer.plan.md Phase 2) builds with adapter-node into `build/`.
		// The browser demo (`npm run demo:build`, ADR-502) is a static
		// single-page app in `build-demo/`: the client, and an `index.html`
		// fallback for every path. It has no server; `$lib/demo` answers the
		// socket and `/api/*` in the page.
		adapter:
			process.env.VAMP_SERVER_BUILD === '1'
				? adapterNode({ out: 'build' })
				: process.env.VAMP_DEMO_BUILD === '1'
					? demoAdapter('build-demo')
					: { name: 'vamp-preview', adapt() {} },
		alias: {
			// `$config` resolves to repo-root `config/` so deep components
			// can `import constants from '$config/constants.json'` instead
			// of climbing six levels of `../`. Code-quality audit follow-up.
			$config: '../config',
			// The screenshot harness's mock surface and fixtures, which the
			// browser demo runs in the page (`$lib/demo`).
			$shot: '../scripts/shot'
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
