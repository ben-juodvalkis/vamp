#!/usr/bin/env node
/**
 * Record a demo scenario against the real Live: the interface in a
 * Chromium window at iPad Pro size with finger circles, Live's window, and
 * Live's audio, into one composed clip with captions.
 * docs/plans/general-release/demo-recording.plan.md has the design;
 * scenarios.mjs has the scenarios and the step format.
 *
 *   npm run demo:record -- [scenario] [options]
 *
 *   --list           The scenarios.
 *   --url <url>      The interface (default http://127.0.0.1:<http.interfacePort>).
 *   --no-record      Play the take without capturing (no Screen Recording
 *                    permission needed): rehearses the steps and the phrases.
 *   --yes            Reset a set that has clips in it. The reset REPLACES
 *                    every track of the open set, so without this it refuses
 *                    unless the set is empty of clips.
 *   --keep-open      Leave the browser up after the take.
 *   --compose-only   Recompose the last take from its raw.mov and take.json.
 *
 * Needs Live running with the Vamp surface, and the bridge and interface
 * up (`npm run dev` or `npm run ipad`). Output: screenshots/demos/<id>/.
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import { Fingers } from '../shot/fingers.mjs';
import { REPO_ROOT } from '../shot/stack.mjs';
import { DEFAULT_VIEWPORT } from '../shot/views.mjs';
import { compose } from './compose.mjs';
import { Live, constants } from './live.mjs';
import { listWindows, startMidiOnly, startRecording } from './recorder.mjs';
import { SCENARIOS } from './scenarios.mjs';

const args = argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const log = (m) => console.log(`[demo] ${m}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (flag('list')) {
	for (const [id, s] of Object.entries(SCENARIOS)) console.log(`  ${id.padEnd(22)} ${s.title}`);
	exit(0);
}

const scenarioId = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--url') ?? 'tour';
const scenario = SCENARIOS[scenarioId];
if (!scenario) {
	console.error(`[demo] no scenario "${scenarioId}" (--list)`);
	exit(2);
}
const url = option('url') ?? `http://127.0.0.1:${constants.http.interfacePort}/`;
const record = !flag('no-record');
const outDir = join(REPO_ROOT, 'screenshots', 'demos', scenarioId);
mkdirSync(outDir, { recursive: true });

// ---- song position -----------------------------------------------------

/** `'bar.beat'` (4/4, 1-based) → beats from the song's start. */
const beatOf = (pos) => {
	const [bar, beat = 1] = String(pos).split('.').map(Number);
	return (bar - 1) * 4 + (beat - 1);
};

/**
 * Live's song position, read off the page's own socket
 * (`/looping/v3/session/song_time`, 10 Hz): the latest sample and when it
 * landed, extrapolated at the tempo. The runner never asks the bridge
 * anything; it listens to what the page is told.
 */
class SongClock {
	constructor(tempo) {
		this.msPerBeat = 60_000 / tempo;
		this.sample = null;
	}
	observe(beats) {
		if (beats > 0) this.sample = { beats, at: performance.now() };
	}
	timeOf(beat) {
		return this.sample.at + (beat - this.sample.beats) * this.msPerBeat;
	}
	/** Resolves at `beat`; returns how late it was, in ms. */
	async until(beat) {
		while (!this.sample) await wait(10);
		for (;;) {
			const left = this.timeOf(beat) - performance.now();
			if (left > 60) await wait(left - 50);
			else {
				if (left > 0) await wait(left);
				return Math.max(0, -left);
			}
		}
	}
}

function watchSongTime(page, clock) {
	const ADDRESS = '/looping/v3/session/song_time';
	const take = (m) => {
		if (m?.address === '/bridge/batch' && Array.isArray(m.messages)) return m.messages.forEach(take);
		if (m?.address !== ADDRESS) return;
		const a = m.args?.[0];
		const v = typeof a === 'object' && a !== null ? a.value : a;
		if (Number.isFinite(Number(v))) clock.observe(Number(v));
	};
	page.on('websocket', (ws) =>
		ws.on('framereceived', ({ payload }) => {
			if (typeof payload !== 'string' || !payload.includes('song_time')) return;
			try {
				take(JSON.parse(payload));
			} catch {
				/* not JSON: not ours */
			}
		})
	);
}

// ---- Live: preflight and reset ------------------------------------------

async function preflight(live) {
	const song = await live.read('song', ['tracks.*name']);
	const names = song['tracks.*name'];
	let clips = 0;
	for (let t = 0; t < names.length; t++) {
		const r = await live.read(`tracks/${t}`, ['clip_slots.*has_clip']);
		clips += r['clip_slots.*has_clip'].filter(Boolean).length;
	}
	if (clips && !flag('yes')) {
		throw new Error(
			`the open set has ${clips} clip(s) on ${names.length} track(s) (${names.join(', ')}). ` +
				'The reset replaces every track. Open a set you can lose, or pass --yes.'
		);
	}
	return names.length;
}

/**
 * The set, built through the LOM: the scenario's tracks with stock
 * devices inserted by name (or, for `set.empty`, the one bare MIDI track a
 * new Live set opens with), the old tracks deleted, transport, key and
 * quantization pinned. No .als, no save sheet.
 */
async function reset(live, oldCount) {
	const set = scenario.set;
	await live.invoke('song', 'stop_playing');
	await live.invoke('song', 'stop_all_clips');
	const song = [
		['tempo', scenario.tempo],
		['clip_trigger_quantization', 4], // 1 bar
		['midi_recording_quantization', 5], // 1/16: absorbs the phrase's jitter
		['metronome', false],
		['session_record', false],
		['record_mode', false],
		['current_song_time', 0]
	];
	await live.set('song', song);
	const tracks = set.empty ? [{ name: '1-MIDI' }] : set.tracks;
	for (const [i, t] of tracks.entries()) {
		await live.invoke('song', 'create_midi_track', [-1]);
		const path = `tracks/${oldCount + i}`;
		if (t.device) await live.invoke(path, 'insert_device', [t.device]);
		await live.set(path, [['name', t.name]]);
	}
	for (let i = 0; i < oldCount; i++) await live.invoke('song', 'delete_track', [0]);
	if (set.groove) {
		// The groove pool is the set's, not a track's, so deleting tracks
		// leaves the last run's amounts on its default groove. Put the named
		// groove back when the pool has it (Groove.Base: 1 = eighths, 3 =
		// sixteenths). A set whose grooves were chosen by hand is left alone;
		// the surface now gives a clip its own groove on the first write, so
		// the shared one no longer drifts between runs anyway.
		const names = (await live.read('song', ['groove_pool.grooves.*name']))['groove_pool.grooves.*name'];
		const i = names.indexOf(set.groove.name);
		if (i < 0) {
			log(`groove: no "${set.groove.name}" in the pool (${names.join(', ')}); leaving the pool as it is`);
		} else {
			const g = `groove_pool.grooves[${i}]`;
			await live.set('song', [
				[`${g}.base`, set.groove.base],
				[`${g}.timing_amount`, set.groove.timing],
				[`${g}.quantization_amount`, set.groove.quantization],
				[`${g}.random_amount`, 0],
				[`${g}.velocity_amount`, 0]
			]);
		}
	}
	if (set.key) {
		// Writing the key is a hand-set key to Key Follow, which turns itself
		// off; a tick later (it classifies the write off song.can_redo) turn
		// it back on, as the Follow switch in the UI would. After the old
		// tracks are gone: turning Follow on runs a pass over what is there.
		await live.set('song', [['root_note', set.key.root], ['scale_name', set.key.scale]]);
		await wait(500);
		live.send('/looping/v3/session/key_follow', [1]);
	}
	// Live's window at the size the frame's pane is shaped for, so the whole
	// window shows uncropped (System Events; needs the window in this Space).
	if (scenario.liveWindow) {
		const { w, h } = scenario.liveWindow;
		try {
			execFileSync('osascript', ['-e', `tell application "System Events" to tell process "Live" to set size of window 1 to {${w}, ${h}}`], { stdio: 'pipe' });
		} catch (e) {
			log(`warning: could not size Live's window to ${w}×${h} (${String(e.stderr ?? e.message).trim()})`);
		}
	}
	// Live's own window: no browser, the session and the device chain.
	await live.invoke('app', 'view.hide_view', ['Browser']).catch(() => {});
	await live.invoke('app', 'view.show_view', ['Session']).catch(() => {});
	await showBothDetailViews(live);
	const after = await live.read('song', ['tracks.*name', 'count_in_duration']);
	if (after.count_in_duration) log(`warning: Live's count-in is on (${after.count_in_duration}); takes will start late`);
	log(`set: ${after['tracks.*name'].join(', ')} at ${scenario.tempo} BPM`);
}

/**
 * Live's clip view and device chain at once: show_view never hides the
 * other, and with both up Live 12 stacks the clip (notes) over the devices.
 */
async function showBothDetailViews(live) {
	await live.invoke('app', 'view.show_view', ['Detail/Clip']).catch(() => {});
	await live.invoke('app', 'view.show_view', ['Detail/DeviceChain']).catch(() => {});
}

// ---- the interface window ------------------------------------------------

async function openInterface(clock) {
	const profile = mkdtempSync(join(tmpdir(), 'vamp-demo-'));
	const context = await chromium.launchPersistentContext(profile, {
		headless: false,
		viewport: null,
		hasTouch: true,
		args: [`--app=${url}`, '--window-size=1000,800', '--hide-scrollbars']
	});
	const page = context.pages()[0] ?? (await context.waitForEvent('page'));
	await context.addInitScript((prefs) => {
		try {
			for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v);
			localStorage.setItem('theme', 'dark');
		} catch {
			/* storage disabled */
		}
	}, scenario.prefs ?? {});
	await context.addInitScript({ path: join(REPO_ROOT, 'scripts', 'demo', 'overlay.js') });
	watchSongTime(page, clock);

	// Fit the iPad's 1366×1024 into the screen: the window is as large as
	// the display allows and the page is laid out at the iPad's size and
	// drawn at `scale` (CDP device-mode scale). The app sees an iPad-sized
	// viewport; CDP input is in window pixels, so taps multiply by `scale`.
	const cdp = await context.newCDPSession(page);
	const { windowId } = await cdp.send('Browser.getWindowForTarget');
	const geo = await page.evaluate(() => ({
		chrome: outerHeight - innerHeight,
		availW: screen.availWidth,
		availH: screen.availHeight,
		availLeft: screen.availLeft ?? 0,
		availTop: screen.availTop ?? 0
	}));
	const { width: W, height: H } = DEFAULT_VIEWPORT;
	const scale = Math.floor(Math.min(1, (geo.availH - geo.chrome - 8) / H, (geo.availW - 8) / W) * 100) / 100;
	const bounds = {
		left: geo.availLeft + geo.availW - Math.round(W * scale),
		top: geo.availTop,
		width: Math.round(W * scale),
		height: Math.round(H * scale) + geo.chrome
	};
	await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
	await cdp.send('Browser.setWindowBounds', { windowId, bounds });
	await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 0, mobile: false, scale });
	await page.reload();
	await page.waitForSelector('.track-col[data-track-index="0"]', { timeout: 20_000 });
	await page.waitForTimeout(1500);
	const got = (await cdp.send('Browser.getWindowBounds', { windowId })).bounds;
	log(`interface: ${W}×${H} drawn at ×${scale} in a ${got.width}×${got.height} window`);
	return { context, page, cdp, scale, chrome: geo.chrome, bounds: got, profile };
}

/**
 * A target's box, in page (CSS) pixels. Waits for it to exist, since the
 * next thing to tap is often still arriving (a browser level, a new strip).
 */
async function boxOf(page, target, timeoutMs = 3000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const box = await page.evaluate((t) => {
			const visible = (el) => {
				const r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0 ? r : null;
			};
			if (t.grid) {
				// The full session grid: the cell under the track's column.
				const col = document.querySelector(`.track-col[data-track-index="${t.grid.track}"]`);
				if (!col) return null;
				const c = col.getBoundingClientRect();
				const cx = c.left + c.width / 2;
				const cell = [...document.querySelectorAll(`.slots-row .slot-cell[data-slot-index="${t.grid.slot}"]`)].find((el) => {
					const r = el.getBoundingClientRect();
					return r.left <= cx && cx <= r.right;
				});
				if (!cell) return null;
				const r = cell.getBoundingClientRect();
				const a = cell.querySelector('.slot-action')?.getBoundingClientRect();
				if (t.grid.part === 'action') return a && { x: a.left, y: a.top, w: a.width, h: a.height };
				if (t.grid.part === 'cell') return { x: r.left, y: r.top, w: r.width, h: r.height };
				const left = a ? a.right : r.left;
				return { x: left, y: r.top, w: r.right - left, h: r.height };
			}
			const hits = [];
			for (const el of document.querySelectorAll(t.css)) {
				if (t.text != null) {
					const label = (t.textCss ? el.querySelector(t.textCss) : el)?.textContent?.trim();
					if (label !== t.text) continue;
				}
				const r = visible(el);
				if (r) hits.push(r);
				if (r && !t.all) break;
			}
			if (!hits.length) return null;
			// `all`: the union of every match (a region made of several parts).
			const x0 = Math.min(...hits.map((r) => r.left));
			const y0 = Math.min(...hits.map((r) => r.top));
			const x1 = Math.max(...hits.map((r) => r.right));
			const y1 = Math.max(...hits.map((r) => r.bottom));
			return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
		}, target);
		if (box) return box;
		if (Date.now() > deadline) throw new Error(`nothing to touch: ${target.label}`);
		await wait(100);
	}
}

// ---- windows to record ---------------------------------------------------

function findWindows(bounds) {
	const windows = listWindows().filter((w) => w.layer === 0);
	const near = (a, b) => Math.abs(a - b) <= 3;
	const browser = windows.find(
		(w) =>
			/chrom/i.test(w.app + w.bundle) &&
			near(w.frame[0], bounds.left) &&
			near(w.frame[1], bounds.top) &&
			near(w.frame[2], bounds.width) &&
			near(w.frame[3], bounds.height)
	);
	if (!browser) throw new Error(`could not find the interface's window at ${JSON.stringify(bounds)}`);
	const livePid = Number(execFileSync('pgrep', ['-x', 'Live'], { encoding: 'utf8' }).trim().split('\n')[0]);
	// Live's main window is its largest titled one; it may sit in another Space.
	const live = windows
		.filter((w) => w.pid === livePid && w.title && w.frame[2] > 400 && w.frame[3] > 300)
		.sort((a, b) => b.frame[2] * b.frame[3] - a.frame[2] * a.frame[3])[0];
	if (!live) throw new Error("could not find Live's main window (is it minimized?)");
	return { browser, live, livePid };
}

// ---- gestures ------------------------------------------------------------------

/** How far ahead of its beat a phrase goes to the recorder. */
const PHRASE_LEAD_MS = 300;
/** How far ahead of its beat a step's box appears and the ring glides to its target. */
const LEAD_MS = 560;

async function pointOf(ui, target, [fx, fy] = [0.5, 0.5]) {
	const b = await boxOf(ui.page, target);
	return { x: b.x + fx * b.w, y: b.y + fy * b.h };
}

const approach = (ui, p) => ui.page.evaluate(({ x, y }) => window.__demo?.approach(x, y), p);

/** Spotlight the union of the targets (or clear it with null). */
async function setBox(ui, box, label, timeoutMs = 3000) {
	if (!box) return ui.page.evaluate(() => window.__demo?.box(null));
	const rects = [];
	for (const t of Array.isArray(box) ? box : [box]) rects.push(await boxOf(ui.page, t, timeoutMs));
	await ui.page.evaluate(({ rects, label }) => window.__demo?.box(rects, label), { rects, label });
}

/**
 * A touch often changes the view under the box (the browser opens, a
 * folder is entered, a preset loads and the browser closes). A moment
 * later, move the box to where its targets are now, or drop it if they
 * are gone, so it never frames whatever took their place.
 */
function refreshBox(ui, step) {
	if (!step.box) return;
	setTimeout(() => {
		setBox(ui, step.box, step.boxLabel, 0).catch(() => setBox(ui, null).catch(() => {}));
	}, 450);
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** One finger on a target: a tap, or a hold of `target.hold` ms. */
async function tap(ui, fingers, target) {
	const p = await pointOf(ui, target, target.at);
	const x = p.x * ui.scale;
	const y = p.y * ui.scale;
	const hold = target.hold ?? 90;
	if (target.pointer === 'mouse') {
		const m = { x, y, button: 'left', clickCount: 1 };
		await ui.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
		await ui.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...m });
		await wait(hold);
		await ui.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...m });
		return;
	}
	const id = await fingers.down(x, y);
	await wait(hold);
	await fingers.up(id);
}

/** A finger down on the path's first point, moved through the rest, eased per segment. */
async function drag(ui, fingers, clock, { target, path, beats, px = false }) {
	const b = await boxOf(ui.page, target);
	// `px`: the path is CSS pixels from the target's centre, for a control
	// whose value is so many pixels of travel (the tempo digits).
	const at = px
		? ([dx, dy]) => [(b.x + b.w / 2 + dx) * ui.scale, (b.y + b.h / 2 + dy) * ui.scale]
		: ([fx, fy]) => [(b.x + fx * b.w) * ui.scale, (b.y + fy * b.h) * ui.scale];
	const total = beats * clock.msPerBeat;
	const segments = path.length - 1;
	const id = await fingers.down(...at(path[0]));
	for (let s = 0; s < segments; s++) {
		const [x0, y0] = at(path[s]);
		const [x1, y1] = at(path[s + 1]);
		const ms = total / segments;
		const t0 = performance.now();
		for (;;) {
			const t = Math.min(1, (performance.now() - t0) / ms);
			const k = ease(t);
			await fingers.move(id, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
			if (t >= 1) break;
			await wait(16);
		}
	}
	await wait(60);
	await fingers.up(id);
}

function schedulePhrase(rec, clock, atBeat, phrase) {
	const now = performance.now();
	const events = [];
	for (const [beat, length, notes, velocity] of phrase) {
		// Just after the grid, never before it: a note that lands a hair
		// before the take starts is lost, one a hair after snaps back.
		const on = clock.timeOf(atBeat + beat) - now + 15;
		const off = clock.timeOf(atBeat + beat + length) - now - 10;
		for (const n of notes) {
			events.push({ inMs: on, bytes: [0x90, n, velocity] });
			events.push({ inMs: off, bytes: [0x80, n, 0] });
		}
	}
	rec.midi(events);
}

// ---- the take ------------------------------------------------------------

async function main() {
	if (flag('compose-only')) {
		const take = JSON.parse(readFileSync(join(outDir, 'take.json'), 'utf8'));
		log(`clip: ${await compose({ dir: outDir, take, log })}`);
		return;
	}
	const live = new Live();
	await live.open();
	const oldCount = await preflight(live);
	await reset(live, oldCount);

	const clock = new SongClock(scenario.tempo);
	const ui = await openInterface(clock);
	const fingers = new Fingers(ui.cdp);
	const vars = {};
	let rec;
	const take = {
		scenario: scenarioId,
		title: scenario.title,
		tempo: scenario.tempo,
		intro: scenario.intro,
		outro: scenario.outro,
		liveCrop: scenario.liveCrop,
		steps: [],
		url
	};
	try {
		if (record) {
			const w = findWindows(ui.bounds);
			log(`recording "${w.browser.title}" and Live's "${w.live.title}" with Live's audio`);
			rec = await startRecording({
				out: join(outDir, 'raw.mov'),
				windows: [w.browser.id, w.live.id],
				audioPid: w.livePid,
				log
			});
			take.tracks = rec.tracks;
			take.ipad = { chromePts: ui.chrome, scale: ui.scale };
		} else {
			rec = await startMidiOnly({ log });
		}

		await live.invoke('song', 'start_playing');
		take.startMark = await rec.mark('transport');

		let chapter = null;
		let chapterIndex = 0;
		let caption = null;
		let note = null;
		let liveBox = null;
		// A scenario's `setup` plays first, on the same clock and through the
		// same fingers, but is not part of the clip: the clip starts at the
		// first of its `steps` (compose trims to the take's steps).
		const all = [...(scenario.setup ?? []).map((s) => ({ ...s, setup: true })), ...scenario.steps];
		for (const [i, step] of all.entries()) {
			const beat = beatOf(step.at);
			// The box, and the ring gliding to the first thing touched, come a
			// little ahead of the beat, so the touch itself lands on it.
			const touches = step.tap ?? step.taps?.[0] ?? step.drag?.target;
			if (touches || 'box' in step || step.liveView) {
				await clock.until(beat - LEAD_MS / clock.msPerBeat);
				// Live's lower panel: asked for both, Live 12 stacks the clip
				// (its notes) over the device chain. Asked again at these steps
				// in case something in between showed only one.
				if (step.liveView) await showBothDetailViews(live);
				if ('box' in step) await setBox(ui, step.box, step.boxLabel);
				if (touches) await approach(ui, await pointOf(ui, touches, step.drag ? (step.drag.px ? [0.5, 0.5] : step.drag.path[0]) : touches.at));
			}
			// A phrase is handed to the recorder ahead of its beat (it times
			// the notes itself), so a slow step before it cannot delay it.
			if (step.play) {
				const early = await clock.until(beat - PHRASE_LEAD_MS / clock.msPerBeat);
				if (early > PHRASE_LEAD_MS - 20) throw new Error(`step ${i + 1} (${step.at}): no time to schedule its phrase`);
				schedulePhrase(rec, clock, beat, step.play);
			}
			const late = await clock.until(beat);
			if (late > clock.msPerBeat / 2) log(`warning: step ${i + 1} (${step.at}) ran ${Math.round(late)} ms late`);
			if (step.setup) {
				// nothing for the clip to show
			} else if (step.chapter) {
				chapter = step.chapter;
				chapterIndex += 1;
			}
			if (step.caption && !step.setup) {
				caption = step.caption;
				note = step.note ?? null;
			}
			if ('live' in step && !step.setup) liveBox = step.live;
			const t = await rec.mark(step.at);
			if (!step.setup) take.steps.push({ at: step.at, t, chapter, index: chapterIndex, caption, note, live: liveBox });
			const what = step.tap?.label ?? step.drag?.target.label ?? (step.taps ? `${step.taps.length} taps` : step.play ? 'phrase' : step.do ? 'do' : '');
			log(`${step.setup ? '·' : ' '}${step.at.padEnd(5)} ${what.padEnd(26)} ${typeof step.caption === 'string' ? step.caption : ''}`);

			if (step.tap) await tap(ui, fingers, step.tap);
			if (step.taps) {
				for (const [k, target] of step.taps.entries()) {
					if (k > 0) {
						await approach(ui, await pointOf(ui, target, target.at));
						await wait(300);
					}
					await tap(ui, fingers, target);
					await wait(Math.max(0, clock.msPerBeat - 390));
				}
			}
			if (step.drag) await drag(ui, fingers, clock, step.drag);
			if (touches) refreshBox(ui, step);
			if (step.do) await step.do(live, vars);
			if (step.until) {
				const next = all[i + 1]?.at ?? scenario.end;
				const budget = clock.timeOf(beatOf(next)) - performance.now() + clock.msPerBeat;
				await live.until(step.until.what, () => step.until.read(live), step.until.test, {
					timeoutMs: Math.max(budget, 1500)
				});
			}
		}
		await clock.until(beatOf(scenario.end));
		take.endMark = await rec.mark('end');
		for (const check of scenario.result) {
			const r = await check.read(live);
			if (!check.test(r)) throw new Error(`result: ${check.what} failed (${JSON.stringify(r)})`);
		}
		take.stopped = await rec.stop();
		rec = null;
		take.ok = true;
	} catch (e) {
		take.ok = false;
		take.error = e.message;
		await ui.page.screenshot({ path: join(outDir, 'failed.png') }).catch(() => {});
		throw e;
	} finally {
		if (rec) await rec.stop().catch(() => rec.kill());
		await live.invoke('song', 'stop_playing').catch(() => {});
		// Captions that quote the take (the key Live ended up in) are filled in now.
		for (const s of take.steps) {
			if (typeof s.caption === 'function') s.caption = s.caption(vars);
			if (typeof s.note === 'function') s.note = s.note(vars);
		}
		take.vars = vars;
		writeFileSync(join(outDir, 'take.json'), JSON.stringify(take, null, '\t'));
		live.close();
		if (!flag('keep-open')) {
			await ui.context.close();
			rmSync(ui.profile, { recursive: true, force: true });
		}
	}

	if (record) {
		log(`clip: ${await compose({ dir: outDir, take, log })}`);
	} else {
		log('rehearsal passed (--no-record: nothing captured)');
	}
}

main().catch((e) => {
	console.error(`[demo] FAILED: ${e.message}`);
	exit(1);
});
