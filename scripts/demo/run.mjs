#!/usr/bin/env node
/**
 * Record a demo scenario against the real Live: the interface in a
 * Chromium window at iPad Pro size with finger circles, Live's window, and
 * Live's audio, into one side-by-side clip.
 * docs/plans/general-release/demo-recording.plan.md has the design.
 *
 *   npm run demo:record -- [scenario] [options]
 *
 *   --list           The scenarios.
 *   --url <url>      The interface (default http://127.0.0.1:<http.interfacePort>).
 *   --no-record      Play the take without capturing (no Screen Recording
 *                    permission needed): rehearses the steps and the phrase.
 *   --yes            Reset a set that has clips in it. The reset REPLACES
 *                    every track of the open set, so without this it refuses
 *                    unless the set is empty of clips.
 *   --keep-open      Leave the browser up after the take.
 *
 * Needs Live running with the Vamp surface, and the bridge and interface
 * up (`npm run dev` or `npm run ipad`). Output: screenshots/demos/<id>/.
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argv, exit } from 'node:process';
import { Fingers } from '../shot/fingers.mjs';
import { REPO_ROOT } from '../shot/stack.mjs';
import { VIEWS, DEFAULT_VIEWPORT } from '../shot/views.mjs';
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

const scenarioId = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--(url)$/)) ?? 'record-and-layer';
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
 * devices inserted by name, the old tracks deleted, transport and
 * quantization pinned. No .als, no save sheet.
 */
async function reset(live, oldCount) {
	await live.invoke('song', 'stop_playing');
	await live.invoke('song', 'stop_all_clips');
	await live.set('song', [
		['tempo', scenario.tempo],
		['clip_trigger_quantization', 4], // 1 bar
		['midi_recording_quantization', 5], // 1/16: absorbs the phrase's jitter
		['metronome', false],
		['session_record', false],
		['record_mode', false],
		['current_song_time', 0]
	]);
	for (const [i, t] of scenario.tracks.entries()) {
		await live.invoke('song', 'create_midi_track', [-1]);
		const path = `tracks/${oldCount + i}`;
		await live.invoke(path, 'insert_device', [t.device]);
		await live.set(path, [['name', t.name]]);
	}
	for (let i = 0; i < oldCount; i++) await live.invoke('song', 'delete_track', [0]);
	const after = await live.read('song', ['tracks.*name', 'count_in_duration']);
	if (after.count_in_duration) log(`warning: Live's count-in is on (${after.count_in_duration}); takes will start late`);
	log(`set: ${after['tracks.*name'].join(', ')} at ${scenario.tempo} BPM`);
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
	const prefs = VIEWS[scenario.view ?? 'session-only'].prefs;
	await context.addInitScript((prefs) => {
		try {
			for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v);
			localStorage.setItem('theme', 'dark');
		} catch {
			/* storage disabled */
		}
	}, prefs);
	await context.addInitScript({ path: join(REPO_ROOT, 'scripts', 'demo', 'touches.js') });
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
	await page.waitForSelector('.slots-row .slot-cell[data-slot-index="0"]', { timeout: 20_000 });
	const got = (await cdp.send('Browser.getWindowBounds', { windowId })).bounds;
	log(`interface: ${W}×${H} drawn at ×${scale} in a ${got.width}×${got.height} window`);
	return { context, page, cdp, scale, chrome: geo.chrome, bounds: got, profile };
}

/** A point on a clip cell, in page (CSS) pixels. */
async function cellPoint(page, { track, slot, part }) {
	const p = await page.evaluate(
		({ track, slot, part }) => {
			const col = document.querySelector(`.track-col[data-track-index="${track}"]`);
			if (!col) return { error: `track ${track} is not on screen` };
			const c = col.getBoundingClientRect();
			const cx = c.left + c.width / 2;
			const cell = [...document.querySelectorAll(`.slots-row .slot-cell[data-slot-index="${slot}"]`)].find((el) => {
				const r = el.getBoundingClientRect();
				return r.left <= cx && cx <= r.right;
			});
			if (!cell) return { error: `track ${track} slot ${slot} is not on screen` };
			const r = cell.getBoundingClientRect();
			const a = cell.querySelector('.slot-action')?.getBoundingClientRect();
			if (part === 'action') {
				if (!a) return { error: `track ${track} slot ${slot} has no action strip` };
				return { x: a.left + a.width / 2, y: a.top + a.height / 2 };
			}
			const left = a ? a.right : r.left;
			return { x: left + (r.right - left) / 2, y: r.top + r.height / 2 };
		},
		{ track, slot, part }
	);
	if (p.error) throw new Error(p.error);
	return p;
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
	const live = windows
		.filter((w) => w.pid === livePid && w.onScreen && w.frame[2] > 400)
		.sort((a, b) => b.frame[2] * b.frame[3] - a.frame[2] * a.frame[3])[0];
	if (!live) throw new Error("could not find Live's main window (is it minimized?)");
	return { browser, live, livePid };
}

// ---- the take ------------------------------------------------------------

async function tap(ui, fingers, spec) {
	const p = await cellPoint(ui.page, spec);
	const id = await fingers.down(p.x * ui.scale, p.y * ui.scale);
	await wait(110);
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

async function main() {
	const live = new Live();
	await live.open();
	const oldCount = await preflight(live);
	await reset(live, oldCount);

	const clock = new SongClock(scenario.tempo);
	const ui = await openInterface(clock);
	const fingers = new Fingers(ui.cdp);
	let rec;
	const take = { scenario: scenarioId, title: scenario.title, tempo: scenario.tempo, steps: [], url };
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

		for (const [i, step] of scenario.steps.entries()) {
			const beat = beatOf(step.at);
			const late = await clock.until(beat);
			if (late > clock.msPerBeat / 2) throw new Error(`step ${i + 1} (${step.caption}) ran ${Math.round(late)} ms late`);
			const t = await rec.mark(step.caption);
			take.steps.push({ at: step.at, caption: step.caption, t });
			log(`${step.at.padEnd(4)} ${step.caption}`);
			if (step.tap) await tap(ui, fingers, step.tap);
			if (step.play) schedulePhrase(rec, clock, beat, step.play);
			if (step.until) {
				const next = scenario.steps[i + 1]?.at ?? scenario.end;
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
		throw e;
	} finally {
		if (rec) await rec.stop().catch(() => rec.kill());
		await live.invoke('song', 'stop_playing').catch(() => {});
		writeFileSync(join(outDir, 'take.json'), JSON.stringify(take, null, '\t'));
		live.close();
		if (!flag('keep-open')) {
			await ui.context.close();
			rmSync(ui.profile, { recursive: true, force: true });
		}
	}

	if (record) {
		const clip = await compose({ dir: outDir, take, log });
		log(`clip: ${clip}`);
	} else {
		log('rehearsal passed (--no-record: nothing captured)');
	}
}

main().catch((e) => {
	console.error(`[demo] FAILED: ${e.message}`);
	exit(1);
});
