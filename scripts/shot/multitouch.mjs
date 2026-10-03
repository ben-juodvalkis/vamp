#!/usr/bin/env node
/**
 * Synthetic multitouch harness — plays the interface with several fingers
 * and asserts on what reached the surface.
 *
 *     npm run multitouch
 *     npm run multitouch -- --scenario two-mutes
 *     npm run multitouch -- --list
 *
 * ## What it is for
 *
 * The pointer program (ADR-427) is a claim about concurrency, and
 * concurrency is exactly what a screenshot cannot photograph and a unit
 * test on a pure machine cannot reach. The machines are proved in
 * `src/__tests__/unit/actions/`; this proves the *wiring* — that the real
 * components, mounted in a real browser, with real Chromium touch input,
 * turn two fingers into two writes.
 *
 * It runs the same stack `shot.mjs` does (mock surface, production
 * web server, Chromium — see `stack.mjs`), so it needs no Ableton Live, no
 * Python surface, no bridge and no iPad — and tolerates them running: the
 * mock moves off a busy :8081 and every context's socket is routed to it, so
 * no finger's write can reach a real bridge. The mock records every message
 * the UI sends, unwrapped from the outbound batcher's envelope, and each
 * scenario asserts on that list.
 *
 * ## Real touch, not synthetic events
 *
 * Fingers are dispatched through CDP `Input.dispatchTouchEvent`, so they
 * enter Chromium's own input pipeline: real hit-testing, real pointer
 * ids, real `touch-action` arbitration. Dispatching `PointerEvent`
 * objects from page script would have been simpler and would also have
 * passed against the code this program replaced — the four dialects were
 * broken at the layer synthetic events skip.
 *
 * ## Two engines
 *
 * `--browser webkit` runs the tap-only scenarios on Playwright's WebKit,
 * a genuinely different engine and the closer of the two to the iPad.
 * `page.touchscreen.tap()` there produces **trusted** `pointerdown` /
 * `pointerup` with `pointerType: 'touch'`, for every `touch-action`
 * value, inside a horizontal scroller or not — measured, not assumed.
 *
 * **What the WebKit pass is worth, stated exactly.** It proves every
 * migrated control answers a single trusted touch on a second engine:
 * right hit-testing, right target, right message on the wire. It is
 * *not* on its own a net for an `onclick` regression — WebKit
 * synthesizes a click from a trusted tap just as it does on any website,
 * so a control reverted to `onclick` still fires here. That was measured
 * the hard way: `tap-mutes` passed against a deliberately regressed
 * mute. The net for that is the **`touch-action` assertion** each tap
 * scenario carries, which fails on both engines the moment a control
 * stops declaring its own — plus `npm run check:touch`, which is static.
 *
 * WebKit has no multi-finger input: CDP is Chromium-only, and
 * `page.touchscreen` exposes `tap` and nothing else — so it also cannot
 * hold or drag a single finger. Scenarios needing either declare
 * `needs: 'multitouch'` and are SKIPPED on WebKit rather than silently
 * passing.
 *
 * ## What neither can tell you
 *
 * Neither engine is iOS Safari, which layers its own gesture
 * recognizers — double-tap zoom, scroll momentum, the touch-delay
 * heuristics — on top of WebKit. The multitouch section of
 * `docs/reference/manual-test-checklist.md` is that half.
 *
 * ## Timing
 *
 * Nothing here waits on `requestAnimationFrame`, and no assertion is
 * built on a `setTimeout` racing the app: a headless page can be
 * throttled or hidden, where rAF never fires at all and timers are
 * clamped. Where a scenario needs the clock — a hold threshold — it
 * spends real wall time with a generous margin and says so.
 *
 * Options:
 *   --list                 Print the scenarios and exit.
 *   --scenario <name>      Run one scenario (repeatable). Default: all.
 *   --browser <name>       chromium (default) or webkit. See "Two engines".
 *   --headed               Show the browser (for watching a failure).
 *   --url <url>            Drive an already-running server.
 *   --keep                 Leave the stack up after the run.
 *   --quiet                Suppress progress chatter.
 */

import { chromium, webkit } from 'playwright';
import { startMockSurface, loadScene } from './mock-surface.mjs';
import { buildDefaultScene } from './scene.mjs';
import { Fingers } from './fingers.mjs';
import { resolveView, DEFAULT_VIEWPORT } from './views.mjs';
import {
	assertMockPort,
	resolveMockPort,
	startServer,
	warmPage,
	launchBrowser
} from './stack.mjs';

assertMockPort('multitouch');

// ---- argv --------------------------------------------------------------

const VALUE_FLAGS = new Set(['scenario', 'url', 'browser']);
const argv = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < argv.length; i++) {
	const token = argv[i];
	if (!token.startsWith('--')) continue;
	const name = token.slice(2);
	const value = VALUE_FLAGS.has(name) ? argv[++i] : true;
	const prior = flags.get(name);
	flags.set(name, prior === undefined ? value : [].concat(prior, value));
}
const has = (n) => flags.has(n);
const flagAll = (n) => {
	const v = flags.get(n);
	return v === undefined ? [] : Array.isArray(v) ? v : [v];
};

const quiet = has('quiet');
const engineName = flagAll('browser')[0] ?? 'chromium';
if (engineName !== 'chromium' && engineName !== 'webkit') {
	console.error(`[multitouch] --browser must be chromium or webkit, got "${engineName}"`);
	process.exit(2);
}
const engine = engineName === 'webkit' ? webkit : chromium;
const log = (m) => !quiet && console.log(`[multitouch:${engineName}] ${m}`);

// ---- the driver handed to each scenario --------------------------------

/**
 * A single trusted tap, on whichever engine is running.
 *
 * Chromium goes through the CDP `Fingers` rig so the tap is one of the
 * same contacts a multitouch scenario uses. WebKit has no CDP and no
 * multi-finger input at all — `page.touchscreen` exposes `tap` and
 * nothing else — so it uses that, which is equally trusted and equally
 * subject to hit-testing and `touch-action`.
 */
function makeTap(page, fingers) {
	if (fingers) return (x, y) => fingers.tap(x, y);
	return (x, y) => page.touchscreen.tap(x, y);
}

/** Centre of the nth match, in CSS pixels. Throws if it isn't there. */
async function centreOf(page, selector, index = 0) {
	const box = await page.evaluate(
		({ selector, index }) => {
			const el = document.querySelectorAll(selector)[index];
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
		},
		{ selector, index }
	);
	if (!box) throw new Error(`no element for ${selector}[${index}]`);
	if (box.w < 1 || box.h < 1) throw new Error(`${selector}[${index}] has no box`);
	return box;
}

/** The `touch-action` Chromium actually computes for a node. */
async function touchActionOf(page, selector, index = 0) {
	return page.evaluate(
		({ selector, index }) => {
			const el = document.querySelectorAll(selector)[index];
			return el ? getComputedStyle(el).touchAction : null;
		},
		{ selector, index }
	);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- assertions --------------------------------------------------------

class Failure extends Error {}

function expect(condition, message) {
	if (!condition) throw new Failure(message);
}

function expectEqual(actual, wanted, message) {
	const a = JSON.stringify(actual);
	const w = JSON.stringify(wanted);
	if (a !== w) throw new Failure(`${message}\n      wanted ${w}\n      got    ${a}`);
}

// ---- scenarios ---------------------------------------------------------

/**
 * Each scenario declares the view it needs (a `views.mjs` name, so the
 * layout prefs are seeded before first paint) and gets `{ page, fingers,
 * sent, reset, domEvents }`. `sent` is every message the UI has sent since
 * the last `reset()`, in order.
 *
 * `trackCount` swaps the mock's scene for a different size. It costs a mock
 * restart, so only ask for it when the track count is the thing under
 * test: the crowded-row scenarios, because the strips row does not become
 * a scroller until the fourteenth track.
 *
 * `needs` says what input the scenario requires:
 *
 *   'multitouch' (default)  concurrent fingers, or a press held across
 *                           other events — Chromium only, SKIPPED on
 *                           WebKit rather than silently passing.
 *   'tap'                   one trusted touch, start to finish. Runs on
 *                           both engines, and on WebKit it is the whole
 *                           portability argument: an `onclick` control
 *                           does nothing there, so a passing tap is
 *                           proof the control moved onto the primitive.
 */
const SCENARIOS = [
	// ---- Single trusted tap. Runs on both engines. ------------------------
	{
		name: 'tap-mutes',
		view: 'full',
		needs: 'tap',
		description: 'one trusted tap on a track name mutes that track',
		async run({ page, tap, sent, reset }) {
			// The declaration, not just the outcome: a control reverted to
			// `onclick` still fires from a trusted tap on both engines, so
			// the missing `touch-action` is what actually catches it. On an
			// 8-track scene the row cannot scroll, so mute owns the gesture.
			expectEqual(
				await touchActionOf(page, '.header-name'),
				'none',
				'the mute target must declare its own touch-action'
			);
			const name = await centreOf(page, '.header-name', 2);
			reset();
			await tap(name.x, name.y);
			await wait(200);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args[0]),
				['tracks/2'],
				'a tap on the name must mute exactly that track, once'
			);
		}
	},

	{
		name: 'tap-transport',
		view: 'full',
		needs: 'tap',
		description: 'one trusted tap on play reaches the transport',
		async run({ page, tap, sent, reset }) {
			expectEqual(
				await touchActionOf(page, '[data-role="transport"]'),
				'none',
				'the transport button must declare its own touch-action'
			);
			const play = await centreOf(page, '[data-role="transport"]');
			reset();
			await tap(play.x, play.y);
			await wait(200);
			const addresses = sent().map((m) => m.address);
			expect(
				addresses.some((a) => /play|transport|stop/.test(a)),
				`the transport tap must reach the wire (saw ${JSON.stringify(addresses)})`
			);
		}
	},

	{
		name: 'tap-stop-cell',
		view: 'session-only',
		needs: 'tap',
		description: 'one trusted tap on a per-track stop cell stops it',
		async run({ page, tap, sent, reset }) {
			expectEqual(
				await touchActionOf(page, '[data-track-stop]'),
				'pan-x',
				'a stop cell under a pannable row must leave the pan alone'
			);
			const stop = await centreOf(page, '[data-track-stop="2"]');
			reset();
			await tap(stop.x, stop.y);
			await wait(200);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/clip/stop')
					.map((m) => m.args[0]),
				['tracks/2'],
				'the stop cell must reach the wire'
			);
		}
	},

	{
		name: 'tap-scene-step',
		view: 'session-only',
		needs: 'tap',
		description: 'one trusted tap on a scene step moves the pedal target',
		async run({ page, tap, sent, reset }) {
			expectEqual(
				await touchActionOf(page, '[data-debug="rail-step-next"]'),
				'none',
				'a scene step owns its gesture'
			);
			const step = await centreOf(page, '[data-debug="rail-step-next"]');
			reset();
			await tap(step.x, step.y);
			await wait(200);
			expect(
				sent().some((m) => m.address === '/looping/v3/selected_clip'),
				'stepping the scene must move the pedal target'
			);
		}
	},

	{
		name: 'tap-launches-clip',
		view: 'session-only',
		needs: 'tap',
		description: 'one trusted tap on a cell action strip fires it',
		async run({ page, tap, sent, reset }) {
			const cell = await centreOf(page, '[data-slot-index]', 0);
			reset();
			await tap(cell.x - cell.w / 2 + 12, cell.y);
			await wait(250);
			expect(
				sent().some(
					(m) =>
						m.address === '/looping/v3/clip/launch' || m.address === '/looping/v3/clip/stop'
				),
				'the action strip must reach the wire'
			);
		}
	},

	// ---- Concurrent fingers. Chromium only (CDP). -------------------------
	{
		name: 'two-mutes',
		view: 'full',
		description: 'two fingers on two track names mute two tracks',
		async run({ page, fingers, sent, reset }) {
			// The trap this whole program starts from: `.header-name`
			// computed `touch-action: auto` because nothing declared it and
			// touch-action does not inherit. Inside a horizontally-scrolling
			// panel `auto` hands the gesture to the browser, which is then
			// free to suppress the click the mute rode on. `use:press`
			// writes it onto the node it binds the handler to.
			expectEqual(
				await touchActionOf(page, '.header-name'),
				'none',
				'the mute target must declare its own touch-action'
			);

			const a = await centreOf(page, '.header-name', 1);
			const b = await centreOf(page, '.header-name', 3);
			reset();

			// Both fingers land BEFORE either lifts. iOS synthesizes at most
			// one click per gesture, so on `onclick` this produced one mute.
			const fa = await fingers.down(a.x, a.y);
			const fb = await fingers.down(b.x, b.y);
			await wait(60);

			// Mute fires at finger-down, not on release (amended 2026-09-03:
			// the release-wait was measured at 103ms from touch-down against
			// Solo's 0ms, and the only thing it bought was a row pan that
			// began on the name band).
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args[0])
					.sort(),
				['tracks/1', 'tracks/3'],
				'both mutes must be on the wire before either finger lifts'
			);

			await fingers.up(fa);
			await fingers.up(fb);
			await wait(120);

			const mutes = sent().filter((m) => m.address === '/looping/v3/track/mute');
			expectEqual(
				mutes.map((m) => m.args[0]).sort(),
				['tracks/1', 'tracks/3'],
				'two names pressed together must mute two different tracks'
			);
		}
	},

	{
		name: 'two-finger-solo-while-muting',
		view: 'full',
		description: 'a two-finger solo held on one strip and a mute tap on another are independent',
		async run({ page, fingers, sent, reset }) {
			const card = await centreOf(page, '[data-debug="track-card"]', 0);
			const name = await centreOf(page, '.header-name', 2);
			reset();

			// The chord fires at the second finger and stays latched while held.
			const fa = await fingers.down(card.x - 10, card.y);
			await wait(30);
			const fb = await fingers.down(card.x + 10, card.y);
			await wait(60);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/solo')
					.map((m) => m.args),
				[['tracks/0', 1]],
				'the chord must solo at the second finger, once'
			);

			// The other hand mutes a different strip. The chord is still
			// open and must not notice.
			await fingers.tap(name.x, name.y);
			await wait(120);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args[0]),
				['tracks/2'],
				'the other hand must mute its own track'
			);

			// Under the hold threshold, so the release latches: no restore.
			await fingers.up(fa);
			await fingers.up(fb);
			await wait(120);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/solo')
					.map((m) => m.args),
				[['tracks/0', 1]],
				'a short release latches the solo'
			);
		}
	},

	{
		name: 'two-finger-solos-on-two-strips',
		view: 'full',
		description: 'two-finger solos on two strips at once are two independent chords',
		async run({ page, fingers, sent, reset }) {
			const a = await centreOf(page, '[data-debug="track-card"]', 0);
			const b = await centreOf(page, '[data-debug="track-card"]', 2);
			reset();
			const a1 = await fingers.down(a.x - 10, a.y);
			const b1 = await fingers.down(b.x - 10, b.y);
			await wait(30);
			const a2 = await fingers.down(a.x + 10, a.y);
			const b2 = await fingers.down(b.x + 10, b.y);
			await wait(60);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/solo')
					.map((m) => m.args),
				[
					['tracks/0', 1],
					['tracks/2', 1]
				],
				'both chords must solo their own strip'
			);
			// Lift in the opposite order to the landing.
			await fingers.up(b2);
			await fingers.up(a2);
			await fingers.up(b1);
			await fingers.up(a1);
			await wait(120);
			expectEqual(
				sent().filter((m) => m.address === '/looping/v3/track/solo').length,
				2,
				'two short releases latch; neither restores'
			);
		}
	},

	{
		name: 'two-finger-solo-latches',
		view: 'full',
		description: 'two fingers on a fader solo the track, a quick lift latches, nothing selects or moves',
		async run({ page, fingers, sent, reset }) {
			const card = await centreOf(page, '[data-debug="track-card"]', 3);
			reset();
			const fa = await fingers.down(card.x - 12, card.y);
			await wait(30);
			const fb = await fingers.down(card.x + 12, card.y);
			await wait(60);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/solo')
					.map((m) => m.args),
				[['tracks/3', 1]],
				'the second finger must solo the track, before anything lifts'
			);
			// Lift the first finger early: the chord holds until the last.
			await fingers.up(fa);
			await wait(60);
			await fingers.up(fb);
			await wait(120);
			const writes = sent().map((m) => m.address);
			expectEqual(
				writes.filter((a) => a === '/looping/v3/track/solo').length,
				1,
				'a quick release latches; nothing restores'
			);
			expect(
				!writes.some((a) => a.includes('volume') || a.includes('select')),
				`the chord must not reach the fader or select; sent ${JSON.stringify(writes)}`
			);
			expect(
				await page.evaluate(
					() => !!document.querySelectorAll('[data-debug="track-card"]')[3]?.querySelector('.solo-tint')
				),
				'the soloed strip must wear the tint'
			);
		}
	},

	{
		name: 'two-finger-solo-momentary',
		view: 'full',
		description: 'two fingers held past the threshold solo only while held',
		async run({ page, fingers, sent, reset }) {
			const card = await centreOf(page, '[data-debug="track-card"]', 3);
			reset();
			const fa = await fingers.down(card.x - 12, card.y);
			await wait(30);
			const fb = await fingers.down(card.x + 12, card.y);
			// Threshold is 300; 600 clears it, as in `solo-momentary`.
			await wait(600);
			await fingers.up(fa);
			await fingers.up(fb);
			await wait(120);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/solo')
					.map((m) => m.args),
				[
					['tracks/3', 1],
					['tracks/3', 0]
				],
				'a long two-finger hold must restore on release'
			);
		}
	},

	{
		name: 'volume-and-mute',
		view: 'full',
		description: 'a volume drag on one strip survives a mute on another',
		async run({ page, fingers, sent, reset, domEvents }) {
			const card = await centreOf(page, '[data-debug="track-card"]', 0);
			const name = await centreOf(page, '.header-name', 4);
			reset();

			// DOWNWARD, from the scene's 0.85: dragging up clamps at 1.0
			// within the first move and the throttle then has no new value
			// to send, which reads exactly like a drag that stopped. The
			// assertion below is on the VALUE for the same reason — a
			// message count measures the throttle, not the gesture.
			const drag = await fingers.down(card.x, card.y);
			await fingers.move(drag, card.x, card.y + 30);
			await fingers.move(drag, card.x, card.y + 60);
			await wait(80);
			const before = sent().filter((m) => m.address === '/looping/v3/track/volume');
			expect(before.length > 0, 'the drag must be writing volume');

			// Second hand mutes elsewhere while the drag is still down.
			await fingers.tap(name.x, name.y);
			await fingers.move(drag, card.x, card.y + 120);
			await fingers.up(drag);
			await wait(200);

			const volumes = sent().filter((m) => m.address === '/looping/v3/track/volume');
			const lastBefore = before.at(-1).args[1];
			const lastAfter = volumes.at(-1).args[1];
			expect(
				lastAfter < lastBefore,
				`the drag must keep tracking after the second finger ` +
					`(was ${lastBefore}, ended ${lastAfter})`
			);
			expect(
				volumes.every((m) => m.args[0] === 'tracks/0'),
				'every volume write must name the dragged track, not the tapped one'
			);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args[0]),
				['tracks/4'],
				'the tap must mute its own track, exactly once'
			);

			// The second finger landing must not make the browser claim the
			// first one. A `pointercancel` here would abandon the drag —
			// and it is the failure mode a same-node two-finger gesture
			// (pinch) actually produces, so it is worth pinning rather than
			// assuming.
			const cancels = (await domEvents()).filter(
				(e) => e.type === 'pointercancel' && e.pointerId === drag
			);
			expectEqual(cancels, [], 'the dragging pointer must not be cancelled');
		}
	},

	{
		name: 'volume-from-the-gutter',
		view: 'full',
		description: 'a drag that lands between two strips, or above a name, is still a fader',
		async run({ page, fingers, sent, reset }) {
			// "Sometimes I drag a strip and nothing happens" (2026-09-25).
			// Measured before the fix, 12 tracks at 1366x1024: 16px of every
			// ~90px of the row was gutter that reached no strip — Chromium
			// cancelled the pointer, the app never saw it — and the volume
			// ticks, the only drawn handle, sit flush against it. The seam
			// between a Card and its name was a second, 4px dead band.
			// Each strip now takes the half-gutter on its side and the seam.
			const geo = await page.evaluate(() => {
				const cols = [...document.querySelectorAll('.track-col')];
				const at = (i) => {
					const card = cols[i].querySelector('[data-debug="track-card"]').getBoundingClientRect();
					const name = cols[i].querySelector('.header-block').getBoundingClientRect();
					return { index: cols[i].dataset.trackIndex, card, name };
				};
				const panel = document.querySelector('.tracks-panel');
				return {
					a: at(1),
					b: at(2),
					overflow: panel.scrollWidth - panel.clientWidth
				};
			});
			const { a, b } = geo;
			const y = (b.card.top + b.card.bottom) / 2;

			async function dragFrom(x, y0, dy = 12) {
				reset();
				const id = await fingers.down(x, y0);
				for (let step = 1; step <= 6; step++) await fingers.move(id, x, y0 + step * dy);
				await fingers.up(id);
				await wait(150);
				return sent().filter((m) => m.address === '/looping/v3/track/volume');
			}
			const tracksOf = (writes) => [...new Set(writes.map((m) => m.args[0]))];

			expect(b.card.left - a.card.right >= 8, 'the row must have a gutter to test');
			expectEqual(
				tracksOf(await dragFrom(b.card.left - 3, y)),
				[`tracks/${b.index}`],
				'the half-gutter left of a strip is that strip\'s fader'
			);
			expectEqual(
				tracksOf(await dragFrom(a.card.right + 3, y)),
				[`tracks/${a.index}`],
				'the half-gutter right of a strip is that strip\'s fader'
			);

			// The seam: flipped (the shipped default, and this view), the
			// name block is BELOW the Card. Asked of the engine's own
			// hit-test rather than with a finger, because a CDP finger
			// cannot ask it here: the name below the 4px seam is focusable
			// (`tabindex="-1"`), and Chromium's touch adjustment moves a
			// `pointerdown` that close to it onto it — measured: a contact
			// in the middle of the seam went to the name even at a 1px
			// radius. Safari adjusts the clicks it synthesizes, not touch
			// or pointer targets, so on the iPad the raw hit-test below is
			// what the finger gets.
			const seam = await page.evaluate(({ x, y }) => {
				const hit = document.elementFromPoint(x, y);
				return {
					fader: !!hit?.closest('.fader'),
					track: hit?.closest('.track-col')?.dataset.trackIndex ?? null
				};
			}, { x: (b.card.left + b.card.right) / 2, y: (b.card.bottom + b.name.top) / 2 });
			expect(b.name.top - b.card.bottom >= 2, 'the Card and the name must have a seam to test');
			expectEqual(seam, { fader: true, track: b.index }, 'the seam above the name is the fader\'s');

			// The slop must not hang past the row: it would make the row
			// scroll, and flip every name band onto the release-wait mute.
			expect(geo.overflow <= 1, `the row must still fit the panel (overflow ${geo.overflow}px)`);
			expectEqual(
				await touchActionOf(page, '.header-name'),
				'none',
				'a 12-track row still cannot scroll, so mute still owns its gesture'
			);
		}
	},

	{
		name: 'volume-from-a-sideways-start',
		view: 'full',
		description: 'with no row to scroll, a fader drag that sets off sideways still moves the volume',
		async run({ page, fingers, sent, reset }) {
			// The other half of "sometimes nothing happens": a drag whose first
			// 12px leaned sideways — a thumb arcs — committed to a row scroll
			// for the rest of its life, on a row with nothing to scroll.
			// Chromium also cancelled the pointer outright once its own slop
			// went sideways under `pan-x`. Both are gone when the row fits:
			// the Card takes `none`, and sideways travel waits for vertical.
			expectEqual(
				await touchActionOf(page, '[data-debug="track-card"]'),
				'none',
				'with no row to pan, the fader must not hand the browser a pan'
			);
			const card = await centreOf(page, '[data-debug="track-card"]', 2);
			const index = await page.evaluate(
				() => document.querySelectorAll('.track-col')[2].dataset.trackIndex
			);
			reset();
			const id = await fingers.down(card.x, card.y - 40);
			await fingers.move(id, card.x + 7, card.y - 39);
			await fingers.move(id, card.x + 13, card.y - 38);
			for (let dy = 10; dy <= 80; dy += 10) await fingers.move(id, card.x + 14, card.y - 38 + dy);
			await fingers.up(id);
			await wait(150);
			const writes = sent().filter((m) => m.address === '/looping/v3/track/volume');
			expect(writes.length > 0, 'the drag must reach the fader');
			expectEqual(
				[...new Set(writes.map((m) => m.args[0]))],
				[`tracks/${index}`],
				'and only this strip\'s'
			);
		}
	},

	{
		name: 'two-clip-launches',
		view: 'session-only',
		description: 'two fingers in the clip grid launch two clips',
		async run({ page, fingers, sent, reset }) {
			// The action strip is the leading edge of a cell, and it is
			// geometry rather than a button — so aim at the left of the box.
			const a = await centreOf(page, '[data-slot-index]', 0);
			const b = await centreOf(page, '[data-slot-index]', 12);
			reset();
			const fa = await fingers.down(a.x - a.w / 2 + 12, a.y);
			const fb = await fingers.down(b.x - b.w / 2 + 12, b.y);
			await fingers.up(fa);
			await fingers.up(fb);
			await wait(150);

			const fired = sent().filter(
				(m) => m.address === '/looping/v3/clip/launch' || m.address === '/looping/v3/clip/stop'
			);
			expect(
				fired.length >= 2,
				`two action-strip presses must reach the wire twice, got ${fired.length}`
			);
			const paths = new Set(fired.map((m) => JSON.stringify(m.args)));
			expect(paths.size >= 2, 'the two presses must name two different slots');
		}
	},

	{
		name: 'two-stops',
		view: 'session-only',
		description: 'two per-track stop buttons pressed together both stop',
		async run({ page, fingers, sent, reset }) {
			expectEqual(
				await touchActionOf(page, '[data-track-stop]'),
				'pan-x',
				'a stop button under a pannable row must not eat the pan'
			);
			const a = await centreOf(page, '[data-track-stop="1"]');
			const b = await centreOf(page, '[data-track-stop="5"]');
			reset();
			const fa = await fingers.down(a.x, a.y);
			const fb = await fingers.down(b.x, b.y);
			await fingers.up(fb);
			await fingers.up(fa);
			await wait(150);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/clip/stop')
					.map((m) => m.args[0])
					.sort(),
				['tracks/1', 'tracks/5'],
				'both stop buttons must reach the wire'
			);
		}
	},

	{
		name: 'mute-momentary',
		view: 'full',
		description: 'holding a mute past the threshold restores it on release',
		async run({ page, fingers, sent, reset }) {
			const name = await centreOf(page, '.header-name', 4);
			reset();
			const id = await fingers.down(name.x, name.y);
			await wait(60);
			// Toggles at finger-down, like Solo.
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args),
				[['tracks/4', 1]],
				'mute must toggle at finger-down'
			);
			// MOMENTARY_HOLD_MS is 300; 600 clears it with room to spare so a
			// throttled headless clock cannot land on the wrong side. The
			// boundary itself is `momentaryPress.test.ts`'s job.
			await wait(600);
			await fingers.up(id);
			await wait(150);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args),
				[
					['tracks/4', 1],
					['tracks/4', 0]
				],
				'a long release must restore the captured pre-press state'
			);
		}
	},

	{
		name: 'mute-tap-latches',
		view: 'full',
		description: 'a short mute tap latches, exactly as before',
		async run({ page, fingers, sent, reset }) {
			const name = await centreOf(page, '.header-name', 5);
			reset();
			const id = await fingers.down(name.x, name.y);
			await wait(80);
			await fingers.up(id);
			await wait(150);
			// One write, not two. The VALUE depends on the scene's own mute
			// state for this track, which is not what this pins — the
			// absence of a restore is.
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args[0]),
				['tracks/5'],
				'a short release latches the down-toggle — one write, no restore'
			);
		}
	},

	{
		name: 'crowded-row-momentary-mute',
		view: 'full',
		trackCount: 18,
		description: 'momentary mute still works when the row is scrollable',
		async run({ page, fingers, sent, reset }) {
			// Here mute fires on RELEASE, so the momentary toggle cannot fire
			// at finger-down. It fires at the HOLD THRESHOLD instead: by
			// 300ms with the finger still down and no cancel, the press is
			// definitively not a pan — the browser decided long ago — so
			// firing then is safe where firing at down was not.
			const name = await centreOf(page, '.header-name', 4);
			reset();
			const id = await fingers.down(name.x, name.y);
			await wait(80);
			expectEqual(
				sent().filter((m) => m.address === '/looping/v3/track/mute').length,
				0,
				'nothing may fire before the hold threshold here'
			);
			await wait(500);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args),
				[['tracks/4', 1]],
				'the hold must start the momentary mute'
			);
			await fingers.up(id);
			await wait(150);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args),
				[
					['tracks/4', 1],
					['tracks/4', 0]
				],
				'…and the release must put it back'
			);
		}
	},

	{
		name: 'crowded-row-restores-the-wait',
		view: 'full',
		trackCount: 18,
		description: 'with a scrollable row, mute waits for the release again',
		async run({ page, fingers, sent, reset }) {
			// The wait is conditional on its own reason for existing
			// (ADR-427 addendum 2). Below 14 tracks the strips row is not a
			// scroller at all, so mute fires at finger-down; at 18 it is,
			// and the name band goes back to deferring to the pan.
			const geom = await page.evaluate(() => {
				// `.tracks-panel` by CLASS: `data-debug="tracks-panel"` is on an
				// outer wrapper in layouts/default/Layout.svelte as well, and that one is not
				// the scroller.
				const el = document.querySelector('.tracks-panel');
				const row = document.querySelector('[data-debug="tracks-row"]');
				return {
					strips: document.querySelectorAll('[data-debug="track-card"]').length,
					clientWidth: el.clientWidth,
					scrollWidth: el.scrollWidth,
					rowWidth: row?.getBoundingClientRect().width,
					minW: getComputedStyle(row).getPropertyValue('--track-min-w'),
					cols: getComputedStyle(row).gridTemplateColumns,
					inline: row?.getAttribute('style')?.slice(0, 120),
					panelOverflowX: getComputedStyle(el).overflowX,
					cardW: document.querySelector('[data-debug="track-card"]')?.getBoundingClientRect().width,
					lastCardRight: [...document.querySelectorAll('[data-debug="track-card"]')].at(-1)?.getBoundingClientRect().right,
					panelLeft: el.getBoundingClientRect().left,
					rowOverflow: getComputedStyle(row).overflow,
					rowScrollWidth: row.scrollWidth,
					colWrapW: document.querySelector('.track-col')?.getBoundingClientRect().width,
					canScroll: (() => { el.scrollLeft = 500; const v = el.scrollLeft; el.scrollLeft = 0; return v; })(),
					panelDisplay: getComputedStyle(el).getPropertyValue('display'),
					panelFlexDir: getComputedStyle(el).getPropertyValue('flex-direction'),
					panelClass: el.className,
					rowDisplay: getComputedStyle(row).getPropertyValue('display'),
					rowMinW: getComputedStyle(row).getPropertyValue('min-width'),
					panelChildren: [...el.children].map((c) => c.className + '@' + Math.round(c.getBoundingClientRect().width)),
					parentOverflow: getComputedStyle(el.parentElement).overflow,
					parentW: el.parentElement.getBoundingClientRect().width
				};
			});
			expect(
				geom.scrollWidth > geom.clientWidth + 1,
				`this scene must actually overflow the row: ${JSON.stringify(geom)}`
			);
			expectEqual(
				await touchActionOf(page, '.header-name'),
				'pan-x',
				'a name band inside a scrollable row must leave the pan to the browser'
			);

			const name = await centreOf(page, '.header-name', 3);
			reset();
			const id = await fingers.down(name.x, name.y);
			await wait(80);
			expectEqual(
				sent().filter((m) => m.address === '/looping/v3/track/mute').length,
				0,
				'mute must NOT have fired at finger-down here'
			);
			await fingers.up(id);
			await wait(150);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args[0]),
				['tracks/3'],
				'…and must fire on the release'
			);
		}
	},

	{
		name: 'crowded-row-pan-abandons-mute',
		view: 'full',
		trackCount: 18,
		description: 'with a scrollable row, a pan from a name does not mute',
		async run({ page, fingers, sent, reset }) {
			const name = await centreOf(page, '.header-name', 3);
			reset();
			const id = await fingers.down(name.x, name.y);
			for (const dx of [10, 30, 60, 100]) await fingers.move(id, name.x - dx, name.y);
			await fingers.up(id);
			await wait(150);
			expectEqual(
				sent().filter((m) => m.address === '/looping/v3/track/mute').length,
				0,
				'panning a scrollable row from a name must never mute the track'
			);
		}
	},

	{
		name: 'row-pans-from-the-card',
		view: 'full',
		// A row that can actually scroll: with the strips fitting the panel
		// the Card takes `touch-action: none` (2026-09-25, see
		// `volume-from-a-sideways-start`), because there is no pan to keep.
		trackCount: 18,
		description: 'the strips row still pans from the Clip/Permute two thirds',
		async run({ page, fingers, sent, reset }) {
			// The name band gave up its pan when mute moved to finger-down
			// (2026-09-03). What has to survive is the pan itself: the Card
			// above it is two thirds of every strip and keeps
			// `touch-action: pan-x` whenever the row can scroll, so the row
			// is still pannable from the large part of the strip.
			expectEqual(
				await touchActionOf(page, '[data-debug="track-card"]'),
				'pan-x',
				'the Card must still defer the horizontal axis to the browser'
			);

			const card = await centreOf(page, '[data-debug="track-card"]', 2);
			reset();
			const id = await fingers.down(card.x, card.y);
			for (const dx of [10, 30, 60, 100]) await fingers.move(id, card.x - dx, card.y);
			await fingers.up(id);
			await wait(150);

			// A horizontal drag on the Card is a row scroll, never a tap:
			// it must not select the track, mute it, or move its volume.
			expectEqual(
				sent()
					.filter(
						(m) =>
							m.address === '/looping/v3/track/mute' ||
							m.address === '/looping/v3/track/volume'
					)
					.map((m) => m.address),
				[],
				'panning the row must not mute or move a fader'
			);
		}
	},

	{
		name: 'scene-steps',
		view: 'session-only',
		description: 'the scene rail step buttons declare a touch-action and fire',
		async run({ page, fingers, sent, reset }) {
			const ta = await touchActionOf(page, '[data-debug="rail-step-next"]');
			expect(ta !== null, 'the scene rail must render its step buttons');
			expectEqual(ta, 'none', 'a scene step owns its gesture');
			const down = await centreOf(page, '[data-debug="rail-step-next"]');
			reset();
			await fingers.tap(down.x, down.y);
			await wait(150);
			expect(
				sent().some((m) => m.address === '/looping/v3/selected_clip'),
				'stepping the scene must move the pedal target'
			);
		}
	},

	{
		name: 'transport-and-metronome',
		view: 'full',
		description: 'play and metronome pressed together both act',
		async run({ page, fingers, sent, reset }) {
			expectEqual(
				await touchActionOf(page, '[data-role="transport"]'),
				'none',
				'the transport button owns its gesture'
			);
			const play = await centreOf(page, '[data-role="transport"]');
			const click = await centreOf(page, '[data-role="metronome"]');
			reset();
			// Both down before either lifts: on `onclick` iOS would have
			// synthesized one of these and dropped the other.
			const fa = await fingers.down(play.x, play.y);
			const fb = await fingers.down(click.x, click.y);
			await fingers.up(fa);
			await fingers.up(fb);
			await wait(200);
			const addresses = sent().map((m) => m.address);
			expect(
				addresses.some((a) => a.includes('metronome')),
				`the metronome press must reach the wire (saw ${JSON.stringify(addresses)})`
			);
			expect(
				addresses.some((a) => a.includes('play') || a.includes('transport') || a.includes('stop')),
				`the transport press must reach the wire (saw ${JSON.stringify(addresses)})`
			);
		}
	},

	{
		name: 'master-select-and-mute',
		view: 'full',
		description: 'selecting master and muting a track are independent presses',
		async run({ page, fingers, sent, reset }) {
			const master = await centreOf(page, '[data-debug="master-card"]');
			const name = await centreOf(page, '.header-name', 5);
			reset();
			const fa = await fingers.down(master.x, master.y);
			const fb = await fingers.down(name.x, name.y);
			await fingers.up(fa);
			await fingers.up(fb);
			await wait(200);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args[0]),
				['tracks/5'],
				'the mute must land on its own track, exactly once'
			);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/select')
					.map((m) => m.args),
				[['master']],
				'the master press must still select the master, exactly once'
			);
		}
	},

	{
		name: 'master-fader-not-a-select',
		view: 'full',
		description: 'a master volume drag no longer also selects on release',
		async run({ page, fingers, sent, reset }) {
			const master = await centreOf(page, '[data-debug="master-card"]');
			reset();
			const id = await fingers.down(master.x, master.y);
			for (const dy of [20, 50, 90]) await fingers.move(id, master.x, master.y + dy);
			await fingers.up(id);
			await wait(200);
			expect(
				sent().some((m) => m.address === '/looping/v3/master/volume'),
				'the drag must write the master volume'
			);
			// The `onclick` this replaced fired on every release, drag
			// included: a fader move also re-selected the master and
			// switched the central view out from under the performer.
			expectEqual(
				sent().filter((m) => m.address === '/looping/v3/track/select').length,
				0,
				'a drag past the slop is not a tap'
			);
		}
	},

	{
		name: 'tempo-drag-and-mute',
		view: 'full',
		description: 'a tempo drag follows its own finger, not the other hand',
		async run({ page, fingers, sent, reset }) {
			expectEqual(
				await touchActionOf(page, '[aria-label="Tempo"]'),
				'none',
				'a drag digit owns its gesture'
			);
			const tempo = await centreOf(page, '[aria-label="Tempo"]');
			const name = await centreOf(page, '.header-name', 6);
			reset();

			// Drag the tempo digit UP in even steps. The header sits at the
			// top of the screen and the strips at the bottom, so the second
			// finger is hundreds of pixels away on the same axis — which is
			// what made the old `touches[0]` read so visible: the tempo
			// jumped to follow whichever finger the browser listed first.
			const id = await fingers.down(tempo.x, tempo.y);
			for (const dy of [10, 20, 30]) await fingers.move(id, tempo.x, tempo.y - dy);
			await wait(60);
			const beforeTap = sent()
				.filter((m) => m.address === '/live/song/set/tempo')
				.map((m) => m.args[0]);
			expect(beforeTap.length > 0, 'the drag must be writing tempo');

			await fingers.tap(name.x, name.y);
			for (const dy of [40, 50, 60]) await fingers.move(id, tempo.x, tempo.y - dy);
			await fingers.up(id);
			await wait(200);

			const all = sent()
				.filter((m) => m.address === '/live/song/set/tempo')
				.map((m) => m.args[0]);
			// Monotonic non-decreasing: every step was upward, so a value
			// that fell means the digit tracked a finger that was not
			// dragging it.
			for (let i = 1; i < all.length; i++) {
				expect(
					all[i] >= all[i - 1],
					`tempo must only rise on an upward drag — saw ${JSON.stringify(all)}`
				);
			}
			expect(
				all.at(-1) > beforeTap.at(-1),
				`the drag must keep tracking past the second finger ` +
					`(was ${beforeTap.at(-1)}, ended ${all.at(-1)})`
			);
			expectEqual(
				sent()
					.filter((m) => m.address === '/looping/v3/track/mute')
					.map((m) => m.args[0]),
				['tracks/6'],
				'the tap must mute its own track'
			);
		}
	},

	// ---- the gesture pin (2026-09-15) ------------------------------------
	//
	// The one failure a unit test on the scope store cannot reach: the pin
	// is fed by WINDOW pointer listeners in the capture phase, and whether
	// those see a real release in the right order — before the pad tile's
	// own handler, after a control has taken the pointer — is a property of
	// the browser, not of the store. This plays it with two real contacts.
	{
		name: 'pad-hold-survives-the-lift',
		view: 'default',
		description: 'lifting a held pad mid-drag keeps the control on that pad',
		async run({ page, fingers, sent, reset }) {
			await openDrumRack(page, fingers);
			const tile = await centreOf(page, '.pad-tile:not(.pad-empty)', 2);
			const note = await page.evaluate(
				() => document.querySelectorAll('.pad-tile:not(.pad-empty)')[2]?.dataset.note
			);
			expect(note, 'the kit must draw a populated pad to hold');
			const slider = await centreOf(page, '.vm-slot-pitch');
			reset();

			// One finger holds the pad past MOMENTARY_HOLD_MS (300); 500
			// clears it with room a throttled headless clock cannot eat.
			const pad = await fingers.down(tile.x, tile.y);
			await wait(500);

			// The other hand drags Trnsp. Under the hold every write is the
			// pad's own row.
			const knob = await fingers.down(slider.x, slider.y);
			for (const dy of [12, 24, 36]) await fingers.move(knob, slider.x, slider.y - dy);
			await wait(80);
			const held = pitchSets(sent());
			expect(held.length > 0, 'the drag must be writing Trnsp');
			expectEqual(
				[...new Set(held.map((m) => m.args[1]))],
				[`vm.pad.${note}.pitch`],
				'while the pad is held, every write must name the pad'
			);

			// THE LIFT. The pad goes, the dragging finger stays down.
			await fingers.up(pad);
			await wait(60);
			const atLift = pitchSets(sent()).length;
			for (const dy of [48, 60, 72]) await fingers.move(knob, slider.x, slider.y - dy);
			await wait(80);

			const afterLift = pitchSets(sent()).slice(atLift);
			expect(afterLift.length > 0, 'the drag must keep writing after the pad lifts');
			expectEqual(
				[...new Set(afterLift.map((m) => m.args[1]))],
				[`vm.pad.${note}.pitch`],
				'the gesture must keep its target — a bare `vm.pitch` here is ' +
					'the whole kit moving to the pad\'s value mid-drag'
			);
			// The tile is still lit, because it is still the target.
			expect(
				await page.evaluate(
					(n) => document.querySelector(`.pad-tile[data-note="${n}"]`)?.classList.contains('pad-held'),
					note
				),
				'the pinned pad must still read as held'
			);

			// The pin is momentary, not a latch: with the hand off the
			// control, the next drag is the kit's again.
			await fingers.up(knob);
			await wait(120);
			const beforeKit = pitchSets(sent()).length;
			const again = await fingers.down(slider.x, slider.y);
			for (const dy of [12, 24]) await fingers.move(again, slider.x, slider.y - dy);
			await fingers.up(again);
			await wait(120);
			expectEqual(
				[...new Set(pitchSets(sent()).slice(beforeKit).map((m) => m.args[1]))],
				['vm.pitch'],
				'once the hand lifts, the kit is the target again'
			);
		}
	}

];

/**
 * Every Trnsp write the UI has sent, in order — the pad's row or the
 * kit's, which is exactly what this scenario is about. Narrowed to the
 * function because pressing a pad also writes `vm.selectedPad` (Live's
 * selection follows the finger), which is not a Trnsp write.
 */
function pitchSets(messages) {
	return messages.filter(
		(m) => m.address === '/looping/v3/property/set' && String(m.args[1]).endsWith('pitch')
	);
}

/**
 * Open the Drums track's instrument view — the Drum Rack view with its pad
 * column, which is the only door to a pad scope. One tap on the strip's
 * device band, which selects the track and opens the view together; the
 * same step `views.mjs` takes for the drum tour states. It was two taps
 * (clip section, then the FX grid's instrument slider) until that slider
 * left the grid on 2026-09-15.
 */
async function openDrumRack(page, fingers) {
	const band = '[data-track-index="0"] [data-section="device"]';
	await page.waitForSelector(band, { timeout: 5000 });
	const slot = await centreOf(page, band);
	await fingers.tap(slot.x, slot.y);
	await page.waitForSelector('.pad-tile:not(.pad-empty)', { timeout: 5000 });
	await page.waitForSelector('.vm-slot-pitch', { timeout: 5000 });
}

// ---- runner ------------------------------------------------------------

if (has('list')) {
	for (const s of SCENARIOS) console.log(`  ${s.name.padEnd(22)} ${s.description}`);
	process.exit(0);
}

const wanted = flagAll('scenario');
const selected = wanted.length
	? SCENARIOS.filter((s) => wanted.includes(s.name))
	: SCENARIOS;
if (!selected.length) {
	console.error(`[multitouch] no scenario matched ${wanted.join(', ')}`);
	process.exit(2);
}

const externalUrl = flagAll('url')[0] ?? null;
let server = null;
let mock = null;
let browser = null;

/** Every message the UI has sent since the last reset, in order. */
let recorded = [];

const results = [];

try {
	// Resolved ONCE, before the first mock: a scene change below restarts the
	// mock, and every restart must land on the port the contexts are routed to.
	// :8081 when it is free, a free ephemeral port when a bridge holds it.
	const { port: mockPort } = await resolveMockPort({ log });

	/** Bring the mock up on a scene of `trackCount` tracks. */
	let mockTrackCount = null;
	async function useScene(trackCount) {
		if (mock && mockTrackCount === trackCount) return;
		if (mock) await mock.close();
		const scene =
			trackCount === null ? await loadScene('default') : buildDefaultScene({ trackCount });
		mock = await startMockSurface({
			port: mockPort,
			scene,
			log: () => {},
			onInbound: (address, args) => recorded.push({ address, args })
		});
		mockTrackCount = trackCount;
		log(`mock surface up, ${trackCount ?? scene.treeArgs ? '' : ''}scene "${scene.name ?? 'unnamed'}"${trackCount ? ` (${trackCount} tracks)` : ''}`);
	}
	await useScene(null);

	let baseUrl = externalUrl;
	if (!externalUrl) {
		server = await startServer({ mode: has('prod') ? 'prod' : 'dev', log, quiet });
		baseUrl = server.baseUrl;
	}

	browser = await launchBrowser(engine, { log });
	if (server?.mode === 'dev') await warmPage(browser, baseUrl, { log });

	for (const scenario of selected) {
		const needs = scenario.needs ?? 'multitouch';
		if (needs === 'multitouch' && engineName !== 'chromium') {
			// Skipped, not passed. WebKit has no multi-finger input at all
			// (CDP is Chromium-only, `page.touchscreen` is tap and nothing
			// else), and a scenario that quietly reports green on an engine
			// it never ran on is worse than one that says so.
			results.push({ name: scenario.name, status: 'skip', detail: '' });
			log(`SKIP  ${scenario.name} — needs concurrent fingers`);
			continue;
		}

		await useScene(scenario.trackCount ?? null);
		const view = resolveView(scenario.view);
		const context = await browser.newContext({
			viewport: DEFAULT_VIEWPORT,
			deviceScaleFactor: 1,
			// Real touch input, and the media queries that come with it.
			hasTouch: true,
			isMobile: false
		});
		// Before the page exists, so its very first socket is intercepted and
		// no finger's write can reach a real bridge on :8081.
		await mock.routePage(context);
		await context.addInitScript(
			({ prefs }) => {
				try {
					for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v);
					localStorage.setItem('theme', 'dark');
				} catch {
					/* storage disabled — fall through to defaults */
				}
			},
			{ prefs: view.prefs }
		);
		const page = await context.newPage();
		// Record the raw pointer lifecycle in the page, so a scenario can
		// assert on what the BROWSER did as well as on what the app sent.
		// `pointercancel` in particular is invisible on the wire — it makes
		// a control do nothing, which is indistinguishable from a control
		// that was never pressed.
		await context.addInitScript(() => {
			window.__mtEvents = [];
			for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
				window.addEventListener(
					type,
					(e) => window.__mtEvents.push({ type, pointerId: e.pointerId }),
					true
				);
			}
		});
		// CDP is Chromium-only. On WebKit the rig runs tap-only scenarios
		// through `page.touchscreen` instead — equally trusted input, one
		// contact at a time.
		const cdp = engineName === 'chromium' ? await context.newCDPSession(page) : null;
		await page.goto(`${baseUrl}${view.path ?? '/'}`, { waitUntil: 'load' });
		// The handshake and the state/full bundle have to land before any
		// strip exists to press. Waiting on the DOM rather than a timeout:
		// the page can be throttled, and a fixed sleep would either be slow
		// or flaky depending on the machine.
		await page.waitForSelector('[data-debug="track-card"]', { timeout: 20_000 });
		await wait(500);

		const fingers = cdp ? new Fingers(cdp) : null;
		const api = {
			page,
			fingers,
			tap: makeTap(page, fingers),
			sent: () => recorded,
			domEvents: () => page.evaluate(() => window.__mtEvents ?? []),
			reset: () => {
				recorded = [];
			}
		};

		let status = 'ok';
		let detail = '';
		try {
			await scenario.run(api);
		} catch (err) {
			status = err instanceof Failure ? 'fail' : 'error';
			detail = err.message;
		}
		try {
			await fingers?.release();
		} catch {
			/* the page may already be gone */
		}
		results.push({ name: scenario.name, status, detail });
		log(`${status === 'ok' ? 'PASS' : status.toUpperCase()}  ${scenario.name}`);
		if (detail) console.log(`        ${detail.replace(/\n/g, '\n        ')}`);
		await context.close();
	}
} finally {
	if (!has('keep')) {
		if (browser) await browser.close();
		if (server) await server.stop();
		if (mock) await mock.close();
	} else {
		log(`stack left up at ${server?.baseUrl ?? externalUrl} — kill it yourself`);
	}
}

const failed = results.filter((r) => r.status !== 'ok' && r.status !== 'skip');
const skipped = results.filter((r) => r.status === 'skip');
const ran = results.length - skipped.length;
console.log(
	`\n[multitouch:${engineName}] ${ran - failed.length}/${ran} scenarios passed` +
		(skipped.length ? ` · ${skipped.length} skipped (need concurrent fingers)` : '')
);
process.exit(failed.length ? 1 : 0);
