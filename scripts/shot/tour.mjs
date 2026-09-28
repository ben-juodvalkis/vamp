#!/usr/bin/env node
/**
 * tour.mjs — every state of a named tour, captured in ONE boot.
 *
 * `shot.mjs` stands the whole stack up for a single capture: a web
 * server, Chromium and the mock, ~15 s a picture. That is fine for one view
 * and a slog for thirty — the central-view divider audit (2026-09-13) was the
 * thirty. A tour starts the web server and Chromium once, then for each
 * state starts a FRESH mock on the scene and opens a fresh browser context
 * seeded with that state's prefs. Fresh because a click that selects a track
 * or loads a device changes the mock, and state N must not inherit what state
 * N-1 did to it.
 *
 * Tours are recipes, so they live in views.mjs beside the views they are
 * built from. A state may `swap` a device in the scene first (scene.mjs
 * `swapDevice`) — how the central tour reaches instruments the scene has no
 * track for — or put the AX helper in another state (`axHelper`), which is
 * what the Drum Rack's swap pill is gated on.
 *
 * Every state is also LAYOUT-CHECKED (layout.mjs, ADR-434): each section
 * divider must have the view's --central-gap on both sides and the content
 * must sit --central-inset from the frame. A violation is printed under the
 * state and fails the run, pictures still written.
 *
 *   npm run shot:tour -- [tour] [options]
 *
 *   --list              Tours and their states.
 *   --only <text>       Capture only the states whose name contains <text>.
 *                       Repeatable.
 *   --out-dir <dir>     Default screenshots/tour/<tour>.
 *   --full              Capture the whole viewport instead of the tour's crop.
 *   --wait <ms>         Settle time after load, before the steps (default 1500).
 *   --viewport <WxH>    Default 1366x1024 (iPad Pro landscape).
 *   --scale <n>         Device pixel ratio (default 2).
 *   --theme <dark|light>
 *   --scene <default|path>
 *   --real-data         Read this machine's generated preset catalogs. By
 *                       default a tour serves the committed fixtures, always:
 *                       it is a comparison set, so two runs of the same code
 *                       should come back the same.
 *   --no-sheet          Skip contact.html / contact.png.
 *   --no-layout         Skip the layout check.
 *   --prod              Drive the production build under `vite preview`
 *                       instead of the dev server (see below).
 *
 * Writes one PNG per state, plus contact.png (every state in a labelled grid)
 * and the contact.html it was rendered from.
 *
 * Like `shot`, a tour drives `vite dev` by default (stack.mjs
 * `startServer`): no build, the pictures are of the source as it stands.
 * `--prod` drives the production build instead, and then photographs the LAST
 * build: run `npm run build` first or the pictures are of older code.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startMockSurface, loadScene } from './mock-surface.mjs';
import { swapDevice } from './scene.mjs';
import { measureLayout, layoutViolations } from './layout.mjs';
import { DEFAULT_VIEWPORT, listTours, resolveTour } from './views.mjs';
import {
	REPO_ROOT,
	assertMockPort,
	resolveMockPort,
	startServer,
	warmPage,
	launchBrowser
} from './stack.mjs';
import {
	LAUNCH_ARGS,
	installCatalogFixtures,
	installSimilarSamplesFixture,
	performSteps
} from './screenshot-page.mjs';

assertMockPort('tour');

// ---- argv --------------------------------------------------------------

const VALUE_FLAGS = new Set(['only', 'out-dir', 'wait', 'viewport', 'scale', 'theme', 'scene']);

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
	for (const tour of listTours()) {
		console.log(`  ${tour.name} — ${tour.description}`);
		for (const s of tour.states) console.log(`      ${s.name.padEnd(28)} ${s.description ?? ''}`);
	}
	process.exit(0);
}

const tour = resolveTour(positionals[0] ?? 'central');
const only = flagAll('only');
const states = only.length
	? tour.states.filter((s) => only.some((text) => s.name.includes(text)))
	: tour.states;
if (!states.length) {
	console.error(`[tour] no state of "${tour.name}" matches --only ${only.join(', ')}`);
	process.exit(2);
}

const [vw, vh] = String(flag('viewport', `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}`))
	.split('x')
	.map(Number);
const viewport = { width: vw || DEFAULT_VIEWPORT.width, height: vh || DEFAULT_VIEWPORT.height };
const scale = Number(flag('scale', 2));
const theme = flag('theme', 'dark');
const settleMs = Number(flag('wait', 1500));
const serverMode = has('prod') ? 'prod' : 'dev';
const sceneRef = flag('scene', 'default');
const outDir = resolve(REPO_ROOT, flag('out-dir', join('screenshots', 'tour', tour.name)));
const full = has('full');
const checkLayout = !has('no-layout');

const log = (msg) => console.log(`[tour] ${msg}`);
const escapeHtml = (s) =>
	String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- contact sheet -----------------------------------------------------

async function writeContactSheet(browser, captured) {
	const figures = captured
		.map(
			({ state, file }) =>
				`<figure><img src="${escapeHtml(basename(file))}"><figcaption>${escapeHtml(state.name)}` +
				` <span>${escapeHtml(state.description ?? '')}</span></figcaption></figure>`
		)
		.join('\n');
	const html = `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(tour.name)} tour</title>
<style>
	body { margin: 0; padding: 20px; background: #101114; color: #e6e6e6;
	       font: 14px -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; }
	h1 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
	.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
	figure { margin: 0; }
	img { display: block; width: 100%; border: 1px solid #2c2e33; }
	figcaption { padding: 6px 2px 0; font-weight: 600; }
	figcaption span { font-weight: 400; color: #9a9ca3; }
</style>
<h1>${escapeHtml(tour.name)} — ${captured.length} states</h1>
<div class="grid">
${figures}
</div>
`;
	const htmlPath = join(outDir, 'contact.html');
	await writeFile(htmlPath, html);
	// shot-harness: no mock route needed — this context only ever opens the
	// local contact.html, never the app, so it has no socket to intercept.
	const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
	try {
		const page = await context.newPage();
		await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
		await page.screenshot({ path: join(outDir, 'contact.png'), fullPage: true });
	} finally {
		await context.close();
	}
}

// ---- main --------------------------------------------------------------

let server = null;
let browser = null;
const captured = [];
const failed = [];
const layoutFailed = [];
const started = Date.now();

try {
	const { chromium } = await import('playwright');
	await mkdir(outDir, { recursive: true });

	log(`${tour.name}: ${states.length} state(s) → ${outDir}`);
	if (serverMode === 'prod') {
		log('--prod photographs the LAST production build — npm run build first if the source moved');
	}
	server = await startServer({ mode: serverMode, log });
	browser = await launchBrowser(chromium, { args: LAUNCH_ARGS, log });
	const { baseUrl } = server;
	if (server.mode === 'dev') await warmPage(browser, baseUrl, { log });
	// Resolved ONCE: each state gets a fresh mock, but they all listen on the
	// same port, and the per-state route below points at it.
	const { port: mockPort } = await resolveMockPort({ log });
	const width = Math.max(...states.map((s) => s.name.length));

	for (const state of states) {
		const t0 = Date.now();
		let mock = null;
		let context = null;
		try {
			const scene = await loadScene(sceneRef);
			if (state.swap) swapDevice(scene, state.swap.path, state.swap);
			// `/bridge/ax_helper` — the Drum Rack pill's gate. A state can put
			// the helper down or untrusted, which is the branch a rig without
			// `npm run install-ax-helper` is actually in and which nothing
			// could photograph while the mock hardcoded `ready`.
			if (state.axHelper) scene.axHelper = { ...scene.axHelper, ...state.axHelper };
			// `/bridge/features` — a view's switch overrides (the `general`
			// edition, a TotalMix that has not answered), then the state's own.
			if (state.features) scene.features = { ...scene.features, ...state.features };
			mock = await startMockSurface({ port: mockPort, scene, log: () => {} });
			context = await browser.newContext({ viewport, deviceScaleFactor: scale });
			// Before the page exists, so its very first socket is intercepted.
			await mock.routePage(context);
			await installCatalogFixtures(context, { force: !has('real-data'), firstRun: state.firstRun === true });
			if (!has('real-data')) await installSimilarSamplesFixture(context, scene);
			await context.addInitScript(
				({ prefs, theme }) => {
					try {
						for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v);
						localStorage.setItem('theme', theme);
					} catch {
						/* storage disabled — fall through to defaults */
					}
				},
				{ prefs: state.prefs, theme }
			);

			const page = await context.newPage();
			const consoleErrors = [];
			page.on('console', (m) => {
				if (m.type() === 'error') consoleErrors.push(m.text());
			});
			page.on('pageerror', (e) => consoleErrors.push(String(e)));

			await page.goto(`${baseUrl}${state.path}`, { waitUntil: 'load' });
			// The settle time counts from the page reaching the mock, not from
			// `load`: under the dev server a module the warm-up did not reach
			// compiles on first import, and a fixed wait from `load` then
			// photographed a page still dialling (measured on a cold server).
			for (let waited = 0; mock.clientCount() === 0 && waited < 30_000; waited += 100) {
				await page.waitForTimeout(100);
			}
			await page.waitForTimeout(settleMs);
			// The old trap's loud version: a state whose page never reached the
			// mock is a picture of whatever else answered on :8081 — the live
			// Ableton set, which photographs as a plausible screenshot.
			if (mock.clientCount() === 0) {
				throw new Error(`page never connected to the mock on :${mock.port}`);
			}
			const { release } = await performSteps(page, state.steps);

			// Measured before the shutter and before a hold is released, so the
			// check sees exactly the screen the picture does.
			const problems = checkLayout ? layoutViolations(await page.evaluate(measureLayout), state.layout) : [];

			const file = join(outDir, `${state.name}.png`);
			const crop = full ? null : state.crop;
			if (crop) await page.locator(crop).first().screenshot({ path: file });
			else await page.screenshot({ path: file });
			await release();

			captured.push({ state, file });
			const note = consoleErrors.length ? `  (${consoleErrors.length} console error(s))` : '';
			const layoutNote = !checkLayout ? '' : problems.length ? `  LAYOUT ✗ ${problems.length}` : '  layout ok';
			log(`${state.name.padEnd(width)}  ${String(Date.now() - t0).padStart(5)} ms${layoutNote}${note}`);
			for (const problem of problems) log(`${' '.repeat(width)}    ${problem}`);
			if (problems.length) layoutFailed.push(state.name);
		} catch (err) {
			failed.push(state.name);
			// Playwright puts WHICH locator it gave up on a few lines down;
			// the first line alone ("Timeout 5000ms exceeded") names nothing.
			const lines = String(err.message ?? err).split('\n');
			const waiting = lines.find((line) => /waiting for/.test(line))?.trim();
			log(`${state.name.padEnd(width)}  FAILED — ${lines[0]}${waiting ? ` (${waiting})` : ''}`);
		} finally {
			if (context) await context.close().catch(() => {});
			if (mock) await mock.close().catch(() => {});
		}
	}

	if (captured.length && !has('no-sheet')) {
		await writeContactSheet(browser, captured);
		log(`contact sheet: ${join(outDir, 'contact.png')}`);
	}
} finally {
	if (browser) await browser.close();
	if (server) await server.stop();
}

log(
	`${captured.length}/${states.length} captured in ${((Date.now() - started) / 1000).toFixed(1)} s` +
		(failed.length ? `; failed: ${failed.join(', ')}` : '') +
		(layoutFailed.length ? `; layout check failed: ${layoutFailed.join(', ')}` : '')
);
process.exit(failed.length || layoutFailed.length ? 1 : 0);
