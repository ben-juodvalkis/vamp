/**
 * What every screenshot harness does to a page — the part `shot.mjs` (one
 * capture per boot) and `tour.mjs` (a whole list of captures per boot) share.
 *
 * `stack.mjs` boots the preview server, the mock and Chromium for every
 * harness, multitouch included, and deliberately leaves out the two things
 * that only matter when you are going to LOOK at the pixels. They live here:
 * the raster-determinism launch flags and the Places-catalog fixture
 * interception. So do the click / drag / hold steps a recipe performs before
 * the shutter. Extracted when the tour landed (2026-09-13) so none of the
 * three gets a second home. `shotFixtures.test.ts` guards the interception.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists } from './stack.mjs';

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const FIXTURE_DATA_DIR = join(FIXTURE_DIR, 'data');

export const LAUNCH_ARGS = [
	// Raster determinism. The interface lays a lot of cards out on fractional
	// pixel boundaries (measured: the key/scale card sits at top=693.344,
	// h=266.656 — and that geometry is bit-stable across reloads, so the drift
	// is NOT layout), and Chromium then rounds those anti-aliased edges one of
	// two ways depending on how raster work got scheduled. Two runs of the same
	// code therefore differ by a handful of edge pixels at a high channel delta.
	'--force-color-profile=srgb',
	'--disable-lcd-text',
	'--run-all-compositor-stages-before-draw',
	'--disable-partial-raster',
	'--disable-skia-runtime-opts',
	// What `--deterministic-mode` used to add, spelled out — minus the one part
	// that broke Linux. That flag is a headless-shell meta flag
	// (headless/lib/browser/command_line_handler.cc in Chromium): it adds these
	// four, the run-all-stages flag above, and `--enable-begin-frame-control`,
	// which makes the compositor wait for BeginFrames sent over DevTools.
	// Playwright never sends one, so on Linux every page.screenshot timed out
	// (measured 2026-09-25, Chrome Headless Shell 151 / Playwright 1.62.1; that
	// flag alone reproduces it). The Mac never saw it: begin-frame control is
	// "headless shell only, not supported on MacOS yet" (Target.pdl), and a full
	// Chromium ignores it. Never add either back — shotFixtures.test.ts guards it.
	'--disable-new-content-rendering-timeout',
	'--disable-image-animation-resync',
	'--disable-threaded-animation',
	'--disable-checker-imaging'
];

/** An empty file of the Places catalog: the index, or one Place. */
function emptyPlaceBody(name) {
	const generatedAt = '2026-08-30T00:00:00.000Z';
	if (name === 'index.json') {
		return {
			metadata: { generatedAt, sidebarRoot: '', source: 'folders', totalItems: 0 },
			places: [],
			aliases: { rules: [], exceptions: {} }
		};
	}
	const placeId = name.replace(/(-samples)?\.json$/, '');
	return {
		metadata: { placeId, name: placeId, path: '', role: null, generatedAt, totalItems: 0, kinds: {} },
		tree: { folders: {}, presets: [] }
	};
}

/**
 * Serve the Places catalog from committed fixtures rather than from whatever
 * `npm run generate-places` found on this machine.
 *
 * The catalog is built from one person's Live library at runtime
 * (`/api/places/*`, the Places service), so every capture that reads it is a
 * photograph of one person's disk. That is how captures became
 * unreproducible: they were taken against a full local library, and a clone
 * with a different one (or none) renders a different rail.
 *
 * Only `/api/places/*.json` (plus the list and the event stream, below) is
 * routed, and every name there is owned: a fixture when `fixtures/data/places/`
 * has one, an empty file otherwise. (Playwright's `*` stops at a slash, so the
 * pattern reaches that one folder and nothing above it.)
 *
 * Two modes, deliberately different:
 *   force: true   the fixtures ALWAYS win (`shot.mjs --fixture-data`, and a
 *                 tour by default). Pass it on both sides of a --diff; it is the
 *                 only thing that makes one a statement about the code rather
 *                 than about the author's sample drive.
 *   force: false  the real catalog wins and the fixture is a 404 fallback,
 *                 so `npm run shot` on a fresh clone still shows a populated
 *                 browser instead of a broken one.
 *
 * Resolves to the fixture files on disk (what a forced capture serves).
 */
export async function installCatalogFixtures(context, { force = false, firstRun = false } = {}) {
	// Settings' Places card and the freshness stream: under `force` the card
	// shows the fixtures' Places as a ticked list, and the stream is refused
	// (a 204 ends an EventSource without a retry), so a capture never waits
	// on this machine's Live library.
	await context.route('**/api/places/list', async (route) => {
		if (!force) return route.continue();
		// The rig's own listing (21 Places, 7 of them ticked, the User Library
		// and 81 Packs), so Settings is photographed at the length it really
		// has; the catalog index is the fallback, every Place in it ticked.
		const listed = join(FIXTURE_DIR, 'places-list.json');
		const index = join(FIXTURE_DATA_DIR, 'places', 'index.json');
		const places = (await exists(listed))
			? JSON.parse(await readFile(listed, 'utf8')).sources
			: (await exists(index))
				? JSON.parse(await readFile(index, 'utf8')).places.map((p) => ({
						key: `place:${p.path}`, kind: 'place', name: p.name, path: p.path, icon: p.icon, present: true,
						ticked: true, id: p.id, totalItems: p.totalItems
					}))
				: [];
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				// `firstRun` photographs the onboarding checklist (a state's `firstRun: true`).
				firstRun,
				version: 1,
				m4lDevices: { path: '/repo/Vamp Devices', place: firstRun ? null : 'Vamp Devices', exact: !firstRun },
				source: 'index',
				indexState: { ok: true, note: '', file: null },
				libraryCfg: null,
				sources: places.map((p) => ({
					...p,
					ticked: firstRun ? false : p.ticked,
					totalItems: firstRun ? null : p.totalItems
				}))
			})
		});
	});
	// The Mac's own network addresses, which Settings turns into the address to
	// open on the iPad: fixed, so a capture never shows this machine's Wi-Fi.
	await context.route('**/api/network', (route) =>
		force
			? route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						hostname: 'looping-studio.local',
						addresses: [
							{ ip: '192.168.100.1', kind: 'usb-c', iface: 'en7' },
							{ ip: '192.168.50.12', kind: 'network', iface: 'en0' }
						]
					})
				})
			: route.continue()
	);
	await context.route('**/api/places/events', (route) => (force ? route.fulfill({ status: 204 }) : route.continue()));
	await context.route('**/api/places/*.json', async (route, request) => {
		const name = new URL(request.url()).pathname.split('/').pop();
		const fixture = join(FIXTURE_DATA_DIR, 'places', name);
		const serveFixture = async () =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: (await exists(fixture)) ? await readFile(fixture, 'utf8') : JSON.stringify(emptyPlaceBody(name))
			});
		if (force) return serveFixture();
		// Fallback mode: let the real catalog answer, and step in only when it
		// isn't there. `route.fetch` rather than `continue` so the 404 is
		// observable without the page ever seeing it.
		try {
			const response = await route.fetch();
			if (response.status() !== 404) return route.fulfill({ response });
		} catch {
			/* server hiccup — fall through to the fixture */
		}
		return serveFixture();
	});
	return readdir(join(FIXTURE_DATA_DIR, 'places')).then((names) => names.filter((n) => n.endsWith('.json')));
}

/**
 * Answer `/api/similar-samples` from the scene rather than from Live's index.
 *
 * That route reads `Live-files-*.db` under `paths.liveDatabaseDir` — the
 * machine-local index Live builds — so off the rig it answers `no-database`
 * (503), and the clip view's swap pill (ADR-440) paints that code in place of
 * the sound's name. The instrument pill's fix was a catalog fixture; this is
 * the same move for the clip pill, and for the same reason: a harness that can
 * only photograph a control broken cannot tell you whether it works.
 *
 * The ranking itself is Live's and is not modelled — the neighbours are the
 * scene's own file plus siblings beside it, in list order. What this makes
 * photographable is the pill's *shape*: a real name, both arrows live, a list
 * to step through.
 *
 * The reference is the file `mock-surface`'s `clip/sample` answers with for
 * the scene's focused clip; a request for any other path still gets the honest
 * 404 the route gives an unindexed file.
 */
export async function installSimilarSamplesFixture(context, scene) {
	const focused = String(scene?.session?.['/looping/v3/clip/focused']?.[0] ?? '');
	const reference = focused ? scene?.audioClips?.[focused] : null;
	if (typeof reference !== 'string' || !reference) return;
	const dir = reference.slice(0, reference.lastIndexOf('/'));
	const stem = reference.slice(reference.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
	const neighbors = [
		{ path: reference, name: `${stem}.wav` },
		{ path: `${dir}/Warm Chime Bed.wav`, name: 'Warm Chime Bed.wav' },
		{ path: `${dir}/Glass Chime Bed.wav`, name: 'Glass Chime Bed.wav' },
		{ path: `${dir}/Dark Chime Bed.wav`, name: 'Dark Chime Bed.wav' }
	];
	await context.route('**/api/similar-samples*', async (route, request) => {
		const asked = new URL(request.url()).searchParams.get('path');
		const body =
			asked === reference
				? { ok: true, neighbors }
				: { ok: false, code: 'not-indexed', detail: `${asked} is not in Live's index` };
		return route.fulfill({
			status: body.ok ? 200 : 404,
			contentType: 'application/json',
			body: JSON.stringify(body)
		});
	});
}

async function centreOf(page, selector, what) {
	const target = page.locator(selector).first();
	await target.waitFor({ state: 'visible', timeout: 5000 });
	const box = await target.boundingBox();
	if (!box) throw new Error(`${what} selector has no box: ${selector}`);
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Perform a recipe's steps, in order, against a loaded page.
 *
 *   { click: selector }                 down-and-up inside one frame.
 *   { click: selector, dom: true }      the element's own click(), with no
 *                                       pointer: for a control the layout at a
 *                                       narrow viewport draws off screen (the
 *                                       System view's gear at phone width), so
 *                                       the screen behind it can still be shot.
 *   { fill: selector, text }            type into a field, as a keyboard would.
 *   { wait: ms }                        let an animation (a smooth scroll) land.
 *   { drag: selector, by?: [dx, dy] }   a real press-move-release in steps, so
 *                                       the drag machine crosses its slop
 *                                       threshold and the control sees a first
 *                                       drag frame — the one event a ghost FX
 *                                       tile loads on (ADR-167). Default 24,-24.
 *   { hold: selector, ms?: number }     press and STAY pressed. The button is
 *                                       still down when this returns, so
 *                                       :active and every pointerdown-armed
 *                                       timer are live in the captured frame;
 *                                       call the returned `release()` after the
 *                                       shutter. Default dwell 450 ms.
 *
 * A hold therefore belongs last: a step after it would run with the button
 * still down.
 */
export async function performSteps(page, steps, { log = () => {} } = {}) {
	let release = async () => {};
	for (const step of steps) {
		if (step.click) {
			log(`clicking ${step.click}`);
			if (step.dom) await page.locator(step.click).first().evaluate((el) => el.click(), undefined, { timeout: 5000 });
			else await page.click(step.click, { timeout: 5000 });
			await page.waitForTimeout(400);
		} else if (step.wait) {
			await page.waitForTimeout(step.wait);
		} else if (step.fill) {
			log(`typing "${step.text}" into ${step.fill}`);
			await page.fill(step.fill, step.text, { timeout: 5000 });
			await page.waitForTimeout(300);
		} else if (step.drag) {
			const [dx, dy] = step.by ?? [24, -24];
			const { x, y } = await centreOf(page, step.drag, '--drag');
			log(`dragging ${step.drag} by ${dx},${dy}`);
			await page.mouse.move(x, y);
			await page.mouse.down();
			const frames = 6;
			for (let i = 1; i <= frames; i++) {
				await page.mouse.move(x + (dx * i) / frames, y + (dy * i) / frames);
				await page.waitForTimeout(16);
			}
			await page.mouse.up();
			await page.waitForTimeout(400);
		} else if (step.hold) {
			const ms = step.ms ?? 450;
			const { x, y } = await centreOf(page, step.hold, '--hold');
			log(`holding ${step.hold} for ${ms}ms`);
			await page.mouse.move(x, y);
			await page.mouse.down();
			await page.waitForTimeout(ms);
			release = () => page.mouse.up();
		} else {
			throw new Error(`Unknown step: ${JSON.stringify(step)}`);
		}
	}
	return { release };
}
