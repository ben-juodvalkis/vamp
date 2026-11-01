#!/usr/bin/env node
/**
 * Lay out Vamp's standalone server (installer.plan.md Phase 2) in
 * `dist/vamp/`: everything the installed app runs, and nothing from
 * `node_modules`' development packages.
 *
 *   dist/vamp/
 *     vamp-server.mjs      the entry (scripts/server/vamp-server.mjs)
 *     build/               the interface, built with adapter-node
 *     bridge/bridge.cjs    the bridge, bundled
 *     scripts/             the server's child scripts and open-live, bundled
 *     config/constants.json
 *     node_modules/audio-decode   the one package the build leaves external, bundled
 *
 *   npm run build:server            then   node dist/vamp/vamp-server.mjs
 *
 * It runs from a checkout; Vamp Devices and the control surface are not here
 * (Phase 4 copies those).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'vamp');
const t0 = Date.now();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. The interface, with adapter-node. Its own folder for the kit's generated
// files, so a gate or `npm run ipad` building meanwhile is not disturbed.
const interfaceBuild = join(root, 'interface', 'build');
rmSync(interfaceBuild, { recursive: true, force: true });
execFileSync('npx', ['vite', 'build'], {
	cwd: join(root, 'interface'),
	stdio: 'inherit',
	env: { ...process.env, VAMP_SERVER_BUILD: '1', LOOPING_KIT_OUT_DIR: '.svelte-kit/server-build', NODE_ENV: 'production' }
});
cpSync(interfaceBuild, join(out, 'build'), { recursive: true });
rmSync(interfaceBuild, { recursive: true, force: true });

const node = { bundle: true, platform: 'node', target: 'node22', logLevel: 'warning', legalComments: 'none' };

// 2. The bridge. ws's two optional native speed-ups stay out: ws runs without.
await build({
	...node,
	entryPoints: [join(root, 'interface', 'bridge', 'enhanced-osc-bridge.js')],
	outfile: join(out, 'bridge', 'bridge.cjs'),
	format: 'cjs',
	external: ['bufferutil', 'utf-8-validate']
});

// 3. The server's child scripts (run with plain Node, `childScript.ts`) and
// open-live, which the grooves endpoint requires.
for (const name of ['bake-thumbnails', 'scan-categories']) {
	await build({ ...node, entryPoints: [join(root, 'scripts', `${name}.ts`)], outfile: join(out, 'scripts', `${name}.mjs`), format: 'esm', external: ['audio-decode'] });
}
await build({ ...node, entryPoints: [join(root, 'scripts', 'open-live.js')], outfile: join(out, 'scripts', 'open-live.js'), format: 'cjs' });
writeFileSync(join(out, 'scripts', 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');

// 4. audio-decode, the build's one external package, as one file.
await build({
	...node,
	entryPoints: [join(root, 'node_modules', 'audio-decode', 'audio-decode.js')],
	outfile: join(out, 'node_modules', 'audio-decode', 'audio-decode.js'),
	format: 'esm'
});
writeFileSync(
	join(out, 'node_modules', 'audio-decode', 'package.json'),
	JSON.stringify({ name: 'audio-decode', type: 'module', main: 'audio-decode.js', exports: { '.': './audio-decode.js' } }) + '\n'
);

// 5. The entry and the tracked defaults.
cpSync(join(root, 'scripts', 'server', 'vamp-server.mjs'), join(out, 'vamp-server.mjs'));
mkdirSync(join(out, 'config'), { recursive: true });
cpSync(join(root, 'config', 'constants.json'), join(out, 'config', 'constants.json'));
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'vamp-server', private: true, type: 'module' }, null, 2) + '\n');

function size(dir) {
	let total = 0;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const s = statSync(p);
		total += s.isDirectory() ? size(p) : s.size;
	}
	return total;
}
console.log(`dist/vamp: ${(size(out) / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
