import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import constants from '../config/constants.json';
import type { Plugin } from 'vite';

/**
 * Pre-bundled dependencies revalidate in dev instead of being trusted for a
 * year (2026-09-15).
 *
 * Vite serves `node_modules/.vite/deps` as `max-age=31536000,immutable` under
 * `?v=<browserHash>`, and 7.1.5 derives that hash from the config, the lockfile
 * and the LIST of dependencies — not from what was bundled. A cache rebuilt
 * with the same list reuses every URL while its chunks differ, and a browser
 * holding old copies mixes them with new ones: two Svelte runtimes. Every load
 * of localhost:3000 died on first render with "Cannot read properties of
 * undefined (reading 'call')" in `get_next_sibling`, importing a chunk the
 * server answered 504 for, while a fresh browser profile loaded the same server
 * cleanly — no start script could clean it out, because the stale copy was in
 * the browser. `no-cache` keeps the ETag, so an unchanged file costs a 304.
 * `npm run ipad` is not exposed: a production build names files by content.
 */
function revalidateOptimizedDeps(): Plugin {
	return {
		name: 'looping:revalidate-optimized-deps',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.url?.includes('/node_modules/.vite/deps/')) {
					const setHeader = res.setHeader.bind(res);
					res.setHeader = ((name: string, value: number | string | readonly string[]) =>
						setHeader(name, name.toLowerCase() === 'cache-control' ? 'no-cache' : value)) as typeof res.setHeader;
				}
				next();
			});
		}
	};
}

export default defineConfig({
	test: {
		// Point `svelte/reactivity` at its CLIENT build under vitest.
		//
		// The package ships `default: index-server.js`, where `SvelteMap` and
		// friends are plain non-reactive collections. Vitest matches `default`,
		// so every `SvelteMap` in the app — the whole v3 normalized store
		// included — was inert in tests and no test could observe a reactivity
		// regression. That is why audit item 24 survived a 1750-test suite:
		// the defect was a plain `Map` inside `$state` signalling nothing, and
		// swapping it for `SvelteMap` changed nothing *in tests* either.
		//
		// An alias rather than `resolve.conditions: ['browser']`: conditions
		// REPLACE the defaults, so `node` drops out and anything Node-targeting
		// (`ws` in the bridge tests) resolves to a browser stub. Measured: that
		// broke 5 test files. This is surgical.
		//
		// The bare `svelte` entry gets the same treatment (2026-09-07, the
		// first component render test — DrumRackCentralView.test.ts): its
		// `default` export is `index-server.js`, whose `mount()` throws
		// `lifecycle_function_unavailable`, so `@testing-library/svelte`
		// could not mount anything. Exact-match regex, deliberately — a plain
		// `'svelte'` key would also rewrite `svelte/internal/client`,
		// `svelte/store` and every other subpath.
		alias: [
			{
				find: 'svelte/reactivity',
				replacement: fileURLToPath(
					new URL('../node_modules/svelte/src/reactivity/index-client.js', import.meta.url)
				)
			},
			{
				find: /^svelte$/,
				replacement: fileURLToPath(
					new URL('../node_modules/svelte/src/index-client.js', import.meta.url)
				)
			}
		],
		include: ['src/**/*.{test,spec}.{js,ts}'],
		// Worker threads, not the default child processes (2026-09-25):
		// 40.7 s -> 32.7 s for the same 2822 tests, all passing, most of it
		// in module import and transform. Per-file isolation is unchanged.
		// A test cannot call process.chdir() in a worker thread.
		pool: 'threads',
		environment: 'jsdom',
		globals: true,
		setupFiles: ['src/__tests__/setup.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/lib/**/*.{ts,svelte.ts}'],
			exclude: [
				'src/lib/**/*.d.ts',
				'src/lib/**/*.test.ts',
				'src/lib/**/*.spec.ts'
			],
			reporter: ['text', 'html']
		}
	},
	// Pre-bundled at server start rather than discovered by the first page
	// load. Measured 2026-09-26 on a fresh container: `devalue` (SvelteKit's
	// client imports it) was found mid-load, and vite answered with "optimized
	// dependencies changed. reloading" — a full page reload in the middle of the
	// first screenshot a dev-server capture takes (scripts/shot, stack.mjs).
	optimizeDeps: {
		include: ['devalue']
	},
	server: {
		host: '0.0.0.0',
		port: constants.http.interfacePort,
		// Any Mac's Bonjour name. Vite always answers to localhost and to any
		// IP address, which is how the iPad reaches it over USB-C or Wi-Fi.
		allowedHosts: ['.local'],
		watch: {
			// Exclude large audio/preset directories from file watching to improve build performance
			ignored: [
				'../ableton/Presets/**',
				'../scripts/device-creation/templates/**',
				'../Samples/**',
				'../temp/**',
				'**/*.wav',
				'**/*.aif',
				'**/*.aiff',
				'**/*.flac',
				'**/*.mp3'
			]
		}
	},
	plugins: [
		revalidateOptimizedDeps(),
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			srcDir: 'src',
			filename: 'service-worker.ts',
			mode: process?.env?.NODE_ENV === 'production' ? 'production' : 'development',
			scope: '/',
			base: '/',
			selfDestroying: process?.env?.NODE_ENV === 'production',
			strategies: 'injectManifest',
			registerType: 'autoUpdate',
			includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
			kit: {
				includeVersionFile: true
			},
			manifest: false, // Use static manifest.json instead
			devOptions: {
				// Disabled in dev: the injectManifest service worker serves
				// app chunks cache-first, so under `vite dev` it pins stale JS
				// and a hard reload (Cmd-Shift-R) can't clear it — only
				// unregistering the SW does. This masked code changes during
				// development (edits appeared not to take effect). The SW is
				// still built + active for the iPad PWA, which runs the
				// production build via `vite preview` (npm run ipad), and is
				// verified there. Re-enable only to debug the SW itself.
				enabled: false,
				suppressWarnings: process?.env?.NODE_ENV === 'development',
				type: 'module',
				navigateFallback: '/'
			}
		})
	],
	build: {
		rollupOptions: {
			// Exclude audio files from dependency analysis during build
			external: (id) => {
				return id.includes('.wav') || 
					   id.includes('.aif') || 
					   id.includes('.aiff') || 
					   id.includes('.flac') || 
					   id.includes('.mp3') ||
					   id.includes('/ableton/Presets/') ||
					   id.includes('/scripts/device-creation/templates/');
			}
		}
	}
});
