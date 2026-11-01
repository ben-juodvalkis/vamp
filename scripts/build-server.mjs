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
 *     data/device-configs.json   read by the control surface
 *     node_modules/audio-decode   the one package the build leaves external, bundled
 *
 *   npm run build:server            then   node dist/vamp/vamp-server.mjs
 *
 * It runs from a checkout; Vamp Devices and the control surface are not here
 * (Phase 4 copies those).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

const node = { bundle: true, platform: 'node', target: 'node22', logLevel: 'warning', legalComments: 'none', metafile: true };
// Every npm package a bundle took in, for the licenses file (step 6).
const bundled = new Set();
const noteInputs = (result) => {
	for (const input of Object.keys(result.metafile.inputs)) {
		const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
		if (m) bundled.add(m[1]);
	}
	return result;
};

// 2. The bridge. ws's two optional native speed-ups stay out: ws runs without.
noteInputs(await build({
	...node,
	entryPoints: [join(root, 'interface', 'bridge', 'enhanced-osc-bridge.js')],
	outfile: join(out, 'bridge', 'bridge.cjs'),
	format: 'cjs',
	external: ['bufferutil', 'utf-8-validate']
}));

// 3. The server's child scripts (run with plain Node, `childScript.ts`) and
// open-live, which the grooves endpoint requires.
for (const name of ['bake-thumbnails', 'scan-categories']) {
	noteInputs(await build({ ...node, entryPoints: [join(root, 'scripts', `${name}.ts`)], outfile: join(out, 'scripts', `${name}.mjs`), format: 'esm', external: ['audio-decode'] }));
}
noteInputs(await build({ ...node, entryPoints: [join(root, 'scripts', 'open-live.js')], outfile: join(out, 'scripts', 'open-live.js'), format: 'cjs' }));
writeFileSync(join(out, 'scripts', 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');

// 4. audio-decode, the build's one external package, as one file.
noteInputs(await build({
	...node,
	entryPoints: [join(root, 'node_modules', 'audio-decode', 'audio-decode.js')],
	outfile: join(out, 'node_modules', 'audio-decode', 'audio-decode.js'),
	format: 'esm'
}));
writeFileSync(
	join(out, 'node_modules', 'audio-decode', 'package.json'),
	JSON.stringify({ name: 'audio-decode', type: 'module', main: 'audio-decode.js', exports: { '.': './audio-decode.js' } }) + '\n'
);

// The interface build inlines what its source imports (the page's packages and
// the server's): every bare import under interface/src, tests aside, plus the
// kit's own runtime.
function sourceImports(dir) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (name === '__tests__' || name === 'node_modules') continue;
		if (statSync(p).isDirectory()) sourceImports(p);
		else if (/\.(ts|js|svelte)$/.test(name)) {
			for (const m of readFileSync(p, 'utf8').matchAll(/\bfrom\s+['"]([^'"./$][^'"]*)['"]/g)) {
				if (m[1].startsWith('node:')) continue;
				const parts = m[1].split('/');
				const pkg = m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
				if (existsSync(join(root, 'node_modules', pkg, 'package.json'))) bundled.add(pkg);
			}
		}
	}
}
sourceImports(join(root, 'interface', 'src'));
for (const name of ['@sveltejs/kit', 'svelte', 'devalue', 'workbox-precaching']) if (existsSync(join(root, 'node_modules', name))) bundled.add(name);

// 5. The entry and the tracked defaults.
cpSync(join(root, 'scripts', 'server', 'vamp-server.mjs'), join(out, 'vamp-server.mjs'));
mkdirSync(join(out, 'config'), { recursive: true });
cpSync(join(root, 'config', 'constants.json'), join(out, 'config', 'constants.json'));
// The control surface reads the device configs from the app's folder.
mkdirSync(join(out, 'data'), { recursive: true });
cpSync(join(root, 'data', 'device-configs.json'), join(out, 'data', 'device-configs.json'));
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'vamp-server', private: true, type: 'module' }, null, 2) + '\n');

// 6. The licenses of every package inside, which bundling strips from the code.
const notices = [...bundled].sort().map((name) => {
	const dir = join(root, 'node_modules', name);
	// A dual-licensed package (osc and slip: MIT or GPL) is used under MIT.
	const files = existsSync(dir) ? readdirSync(dir).filter((f) => /licen[cs]e|copying/i.test(f)) : [];
	const file = files.find((f) => /mit/i.test(f)) ?? files[0];
	const pkg = existsSync(join(dir, 'package.json')) ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) : {};
	const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'not stated'} (the package ships no license file).`;
	return `## ${name} ${pkg.version ?? ''}\n\n${text}\n`;
});
writeFileSync(join(out, 'THIRD-PARTY-LICENSES.md'), `# Packages inside Vamp's server\n\n${notices.join('\n')}`);

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
