/**
 * The strip's fader, as the finger meets it (2026-09-25).
 *
 * Reported as "sometimes I drag a strip to set volume and it does nothing;
 * trying again usually works". Two causes, both measured on the mock stack
 * with real Chromium touch (`npm run multitouch`):
 *
 *  - the 16px gutter between strips, and the seam between the Card and the
 *    name, reached no strip at all — and the volume ticks, the only drawn
 *    handle, sit flush against that gutter;
 *  - with no row to scroll, a drag whose first 12px leaned sideways was a
 *    "row scroll" of nothing for the rest of its life.
 *
 * `useStripGestures.test.ts` and `dragMachine.test.ts` pin the rules; this
 * pins the wiring: the gesture is bound to the hit box around the Card
 * rather than the Card itself, and the strip hands the machine the row's
 * real answer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { _resetForTests, replaceTree, type TrackRecord } from '$lib/stores/v3/normalized.svelte';
import TrackStrip from '$lib/components/v6/tracks/TrackStrip.svelte';

const TRACK_INDEX = 2;
const TRACK = `tracks/${TRACK_INDEX}`;
const CARD_HEIGHT = 200;

function track(): TrackRecord {
	return {
		trackPath: TRACK,
		name: 'T',
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		volume: 0.5,
		devices: new SvelteMap(),
		slots: new SvelteMap()
	};
}

/** The stand-in `useStripGestures.test.ts` uses: jsdom has no PointerEvent. */
function pointer(type: string, x: number, y: number): PointerEvent {
	const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
	Object.defineProperty(ev, 'pointerId', { value: 7 });
	Object.defineProperty(ev, 'pointerType', { value: 'touch' });
	return ev as unknown as PointerEvent;
}

function mount(rowScrolls: boolean) {
	const { container } = render(TrackStrip, { props: { trackIndex: TRACK_INDEX, rowScrolls } });
	const fader = container.querySelector<HTMLElement>('.fader');
	const card = container.querySelector<HTMLElement>('[data-debug="track-card"]');
	if (!fader || !card) throw new Error('strip rendered without its fader or card');
	// jsdom lays nothing out, and the drag is a fraction of the Card's height.
	card.getBoundingClientRect = () =>
		({ height: CARD_HEIGHT, width: 80, top: 0, left: 0, right: 80, bottom: CARD_HEIGHT, x: 0, y: 0 }) as DOMRect;
	return { fader, card };
}

/** Down on `target`, then every point in `path` on `window`, then up. */
function drag(target: HTMLElement, path: Array<[number, number]>) {
	const [x0, y0] = path[0];
	target.dispatchEvent(pointer('pointerdown', x0, y0));
	for (const [x, y] of path.slice(1)) window.dispatchEvent(pointer('pointermove', x, y));
	const [x1, y1] = path.at(-1)!;
	window.dispatchEvent(pointer('pointerup', x1, y1));
}

function volumeWrites(): Array<[string, number]> {
	return vi
		.mocked(send)
		.mock.calls.filter(([address]) => address === '/looping/v3/track/volume')
		.map(([, args]) => args as [string, number]);
}

beforeEach(() => {
	_resetForTests();
	vi.mocked(send).mockClear();
	replaceTree(1, [track()]);
});

afterEach(() => {
	cleanup();
});

describe('TrackStrip — the fader hit box', () => {
	it('a press on the box beside the Card is this strip\'s fader', () => {
		// What a press on `.fader::before` — the half-gutter, the seam —
		// looks like to the DOM: its target is the box, not the Card.
		const { fader } = mount(false);
		drag(fader, [
			[-4, 100],
			[-4, 120],
			[-4, 150]
		]);
		const writes = volumeWrites();
		expect(writes.length).toBeGreaterThan(0);
		expect(writes.every(([path]) => path === TRACK)).toBe(true);
		// 50px down a 200px Card, from 0.5.
		expect(writes.at(-1)![1]).toBeCloseTo(0.25, 5);
	});

	it('a press on the Card still reaches it through the box', () => {
		const { card } = mount(false);
		drag(card, [
			[40, 100],
			[40, 80],
			[40, 60]
		]);
		expect(volumeWrites().at(-1)![1]).toBeCloseTo(0.7, 5);
	});

	// The `touch-action` half (none with no row to pan, pan-x with one) is
	// asserted where it is computed: jsdom's CSS parser drops the property,
	// so `npm run multitouch` reads it off real Chromium instead
	// (`volume-from-a-sideways-start`, `row-pans-from-the-card`).

	it('with no row to scroll, a drag that sets off sideways still moves the volume', () => {
		const { card } = mount(false);
		drag(card, [
			[40, 100],
			[53, 98], // 13px sideways first: a row scroll, under the old rule
			[54, 60]
		]);
		expect(volumeWrites().at(-1)![1]).toBeCloseTo(0.7, 5);
	});

	it('with a row to scroll, the same start is still the row\'s', () => {
		const { card } = mount(true);
		drag(card, [
			[40, 100],
			[53, 98],
			[54, 60]
		]);
		expect(volumeWrites()).toEqual([]);
	});
});
