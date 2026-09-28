#!/usr/bin/env node
/**
 * Headless screenshot harness.
 *
 * One command turns a checkout into a PNG of the interface, with no
 * Ableton Live, no Python surface, no bridge and no iPad:
 *
 *     npm run shot -- session
 *
 * It also works with all of them RUNNING: when a bridge holds the port the
 * page dials, the mock moves to a free one and the page's socket is routed to
 * it, so the capture is still of the scene and the rig is left alone. See the
 * README's "Shooting while the rig is running".
 *
 * It boots a web server (a warm `vite dev` by default, the production
 * build with `--prod`), starts `mock-surface.mjs` in
 * place of the whole downstream stack, drives Chromium at iPad viewport,
 * and writes `screenshots/<view>.png`.
 *
 * The point is remote work: a session that can't reach a Mac can still
 * see what a layout change actually looks like. Pair it with `--diff`
 * to prove a change is visually inert (the ADR-415 method), or with
 * `--interactive` to leave the stack up and poke at it in a browser.
 * For many captures in one boot, see `tour.mjs` (`npm run shot:tour`).
 *
 * Usage:
 *   node scripts/shot/shot.mjs [view] [options]
 *
 * Options:
 *   --list                 Print the available views and exit.
 *   --out <path>           Output file (default screenshots/<view>.png).
 *   --viewport <WxH>       Override viewport (default 1366x1024, iPad Pro landscape).
 *   --scale <n>            Device pixel ratio (default 2).
 *   --theme <dark|light>   Seed the theme store (default dark).
 *   --scene <default|path> Fixture to replay (default: the synthetic set).
 *   --url <url>            Shoot an already-running server instead of booting one.
 *   --prod                 Shoot the production build (`vite preview`) instead of
 *                          the dev server. It photographs the LAST build, so
 *                          `npm run build` first. The dev server (the default) is
 *                          left running between runs so the next one is warm;
 *                          `npm run shot:stop` stops it.
 *   --no-mock              Don't start the mock surface (talk to a real bridge).
 *   --wait <ms>            Settle time before capture (default 2500).
 *   --full-page            Capture the whole scrollable page.
 *   --click <selector>     Click before capturing. Repeatable, in order.
 *   --hold <selector>      Press and STAY pressed through the capture. The
 *                          interface's gestures are pointerdown-timed (a
 *                          browser folder picks a random preset at 200ms, the
 *                          ClipCentralView holds fire at 800ms), and --click is
 *                          down-and-up inside one frame, so nothing mid-press
 *                          is otherwise capturable. Pair with --hold-ms.
 *   --hold-ms <ms>         Dwell before capturing while held (default 450).
 *                          Shorter than the gesture's threshold captures the
 *                          build-up; longer captures what it turned into.
 *   --drag <selector>      Press the element's centre, move by --drag-by in a
 *                          few steps, release. Repeatable, in order, after the
 *                          clicks. What a --click cannot do: an FX-grid tile
 *                          loads its effect on the first DRAG frame, never on
 *                          a tap (ADR-167 — a tap only opens the view), so a
 *                          ghost tile is brought to life with this.
 *   --drag-by <dx,dy>      The drag's travel in CSS px (default 24,-24).
 *   --fixture-data         Serve every /api/places/*.json from
 *                          scripts/shot/fixtures/data/places/ instead of the
 *                          real Places catalog. The catalog is generated from
 *                          whatever preset library the machine happens to have
 *                          and is gitignored, so a capture that reads it is
 *                          a photograph of one person's disk — which is how the
 *                          captures came to be unreproducible on any other Mac.
 *                          Pass it on both sides of a --diff. WITHOUT it the
 *                          real catalog wins and the fixtures are used only as
 *                          a 404 fallback, so a fresh clone still paints a
 *                          populated browser rail instead of a failed one.
 *   --reduced-motion       Emulate `prefers-reduced-motion: reduce`. Pass it on
 *                          both sides of a --diff: the recording-clip pulse and the
 *                          queued-launch blink are time-based, so a capture of
 *                          a set that is recording lands on a different frame
 *                          every run. The app already answers that media query
 *                          by holding the mark and dropping the animation, so
 *                          this freezes what a capture cannot otherwise pin.
 *   --diff <png>           Also pixel-diff the capture against an existing PNG.
 *   --interactive          Leave the stack running and print the URL; don't capture.
 *   --quiet                Suppress progress chatter.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { startMockSurface, loadScene } from './mock-surface.mjs';
import { listViews, resolveView, DEFAULT_VIEWPORT } from './views.mjs';
import {
	REPO_ROOT,
	CLIENT_WS_PORT,
	assertMockPort,
	resolveMockPort,
	startServer,
	warmPage,
	launchBrowser
} from './stack.mjs';
// The raster flags, the catalog fixture interception and the click / drag /
// hold steps are shared with tour.mjs — see screenshot-page.mjs.
import {
	LAUNCH_ARGS,
	installCatalogFixtures,
	installSimilarSamplesFixture,
	performSteps
} from './screenshot-page.mjs';

const DEFAULT_SETTLE_MS = 2500;

assertMockPort('shot');

// ---- argv --------------------------------------------------------------

/** Flags that consume the following token; everything else is boolean. */
const VALUE_FLAGS = new Set([
	'out',
	'viewport',
	'scale',
	'theme',
	'scene',
	'url',
	'wait',
	'click',
	'hold',
	'hold-ms',
	'drag',
	'drag-by',
	'diff'
]);

const argv = process.argv.slice(2);
const flags = new Map();
const positionals = [];
for (let i = 0; i < argv.length; i++) {
	const token = argv[i];
	if (!token.startsWith('--')) {
		positionals.push(token);
		continue;
	}
	const name = token.slice(2);
	const value = VALUE_FLAGS.has(name) ? argv[++i] : true;
	const prior = flags.get(name);
	flags.set(name, prior === undefined ? value : [].concat(prior, value));
}

const has = (name) => flags.has(name);
const flag = (name, fallback) => {
	const v = flags.get(name);
	if (v === undefined) return fallback;
	return Array.isArray(v) ? v[v.length - 1] : v;
};
const flagAll = (name) => {
	const v = flags.get(name);
	if (v === undefined) return [];
	return Array.isArray(v) ? v : [v];
};

if (has('list')) {
	for (const { name, description } of listViews()) {
		console.log(`  ${name.padEnd(14)} ${description}`);
	}
	process.exit(0);
}

const view = resolveView(positionals[0] ?? 'default');

const quiet = has('quiet');
const log = (msg) => {
	if (!quiet) console.log(`[shot] ${msg}`);
};

const [vw, vh] = String(flag('viewport', `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}`))
	.split('x')
	.map(Number);
const viewport = { width: vw || DEFAULT_VIEWPORT.width, height: vh || DEFAULT_VIEWPORT.height };
const scale = Number(flag('scale', 2));
const theme = flag('theme', 'dark');
const settleMs = Number(flag('wait', DEFAULT_SETTLE_MS));
const outPath = resolve(REPO_ROOT, flag('out', join('screenshots', `${view.name}.png`)));
const diffAgainst = flag('diff', null);
const interactive = has('interactive');
const useMock = !has('no-mock');
const externalUrl = flag('url', null);
const forceFixtureData = has('fixture-data');

// ---- main --------------------------------------------------------------

let server = null;
let mock = null;
let browser = null;
// The replayed scene, kept past the mock's setup because the page-side
// fixtures are derived from it too (`installSimilarSamplesFixture`).
let sceneForFixtures = null;

try {
	const { chromium } = await import('playwright');

	if (useMock) {
		sceneForFixtures = await loadScene(flag('scene', 'default'));
		// A view can switch a bridge feature off, or leave it on and
		// unanswered (`general`, `totalmix-down`), the way a tour state
		// puts the AX helper down.
		if (view.features) {
			sceneForFixtures.features = { ...sceneForFixtures.features, ...view.features };
		}
		// :8081 when it is free, a free ephemeral port when a bridge already
		// holds it. Either way the context below routes the page's socket
		// here, so the capture cannot be of the live set.
		const { port } = await resolveMockPort({ log });
		mock = await startMockSurface({
			port,
			scene: sceneForFixtures,
			log: (m) => !quiet && console.log(`[mock] ${m}`)
		});
		log(`mock surface up, scene "${sceneForFixtures.name ?? 'unnamed'}"`);
	}

	let baseUrl = externalUrl;
	if (!externalUrl) {
		server = await startServer({ mode: has('prod') ? 'prod' : 'dev', log, quiet });
		baseUrl = server.baseUrl;
	}

	browser = await launchBrowser(chromium, { args: LAUNCH_ARGS, log });
	if (server?.mode === 'dev') await warmPage(browser, baseUrl, { log });
	const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
	// Before the page exists, so its very first socket is already intercepted.
	if (mock) await mock.routePage(context);
	const fixtured = await installCatalogFixtures(context, { force: forceFixtureData });
	log(
		`Places catalog: ${forceFixtureData ? 'fixtures forced' : 'real, fixtures on 404'} ` +
			`(${fixtured.length} fixture file(s))`
	);
	// Live's own sample index answers the clip view's swap pill, and it is not
	// on this machine (nor on any machine without Live). Same argument as the
	// catalogs above, so the same treatment — but only when the catalogs are
	// forced, since `--real-data`'s whole point is to read the real thing.
	if (forceFixtureData && sceneForFixtures) await installSimilarSamplesFixture(context, sceneForFixtures);

	// Seed prefs before any app code runs, so the first paint is already
	// the layout we asked for.
	await context.addInitScript(
		({ prefs, theme }) => {
			try {
				for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v);
				localStorage.setItem('theme', theme);
			} catch {
				/* storage disabled — fall through to defaults */
			}
		},
		{ prefs: view.prefs, theme }
	);

	const page = await context.newPage();
	if (has('reduced-motion')) {
		// See the flag's note above: this is how a set with a RECORDING
		// clip in it becomes capturable at all.
		await page.emulateMedia({ reducedMotion: 'reduce' });
	}
	const consoleErrors = [];
	page.on('console', (m) => {
		if (m.type() === 'error') consoleErrors.push(m.text());
	});
	page.on('pageerror', (e) => consoleErrors.push(String(e)));

	await page.goto(`${baseUrl}${view.path}`, { waitUntil: 'load' });
	// Settle from the page reaching the mock, not from `load` (tour.mjs says why).
	for (let waited = 0; mock && mock.clientCount() === 0 && waited < 30_000; waited += 100) {
		await page.waitForTimeout(100);
	}
	await page.waitForTimeout(settleMs);

	// The old trap's loud version. A capture whose page never reached the mock
	// is a capture of whatever else answered — the live Ableton set, which
	// photographs as a perfectly plausible screenshot.
	if (mock && mock.clientCount() === 0) {
		throw new Error(
			`the page never connected to the mock on :${mock.port} — refusing to write a ` +
				'capture that is not of the scene'
		);
	}

	// The flags become one ordered recipe — every click, then every drag, then
	// the hold (see --drag and --hold above) — performed by the same code a
	// tour's states use. A hold leaves the button down across the screenshot.
	const [dragDx, dragDy] = String(flag('drag-by', '24,-24')).split(',').map(Number);
	const holdSelector = flag('hold');
	const steps = [
		...flagAll('click').map((click) => ({ click })),
		...flagAll('drag').map((drag) => ({ drag, by: [dragDx, dragDy] })),
		...(holdSelector ? [{ hold: holdSelector, ms: Number(flag('hold-ms', 450)) }] : [])
	];
	const { release } = await performSteps(page, steps, { log });

	if (interactive) {
		console.log(`\n  Interface: ${baseUrl}${view.path}`);
		console.log(`  View:      ${view.name} — ${view.description}`);
		if (mock && mock.port !== CLIENT_WS_PORT) {
			// Only Playwright's own window is routed. A browser you open
			// yourself dials :8081 and gets whatever holds it — here, the
			// bridge and the live set.
			console.log(
				`\n  ⚠ :${CLIENT_WS_PORT} is taken, so the mock is on :${mock.port} and only the\n` +
					'    window this harness opened is routed to it. A browser YOU open at the\n' +
					'    URL above will talk to the real bridge instead. Stop the bridge for an\n' +
					'    interactive session, or drive the window this opened.'
			);
		}
		console.log('  Ctrl-C to tear everything down.\n');
		// Park until interrupted. The `finally` below never runs on a
		// signal, so tear the stack down here or the preview server
		// outlives the Ctrl-C and holds its port.
		await new Promise((resolveSignal) => {
			const bye = async () => {
				if (browser) await browser.close().catch(() => {});
				if (mock) await mock.close().catch(() => {});
				if (server) await server.stop();
				resolveSignal();
			};
			process.once('SIGINT', bye);
			process.once('SIGTERM', bye);
		});
		process.exit(0);
	}

	await mkdir(dirname(outPath), { recursive: true });
	await page.screenshot({ path: outPath, fullPage: has('full-page') });
	await release();
	log(`wrote ${outPath}`);

	if (consoleErrors.length) {
		console.warn(`[shot] ${consoleErrors.length} console error(s) during capture:`);
		for (const e of consoleErrors.slice(0, 5)) console.warn(`  ${e.slice(0, 300)}`);
	}

	if (diffAgainst) {
		const { diffPngs } = await import('./diff.mjs');
		const result = await diffPngs(resolve(REPO_ROOT, diffAgainst), outPath);
		console.log(
			`[shot] diff vs ${diffAgainst}: ${result.differing}/${result.total} px differ ` +
				`(${result.percent.toFixed(4)}%), max channel delta ${result.maxDelta}`
		);
	}
} finally {
	if (browser) await browser.close();
	if (mock) await mock.close();
	if (server) await server.stop();
}
