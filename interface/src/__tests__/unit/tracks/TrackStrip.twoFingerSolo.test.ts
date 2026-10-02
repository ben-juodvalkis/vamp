/**
 * Two fingers on a strip's fader solo it (2026-10-01).
 *
 * The chord itself — when a second finger is claimed, that the first
 * finger's tap is dropped, that the last lift ends it — is pinned in
 * `useStripGestures.test.ts`. This pins what the strip does with it: the
 * Solo button's release rule (tap latches, hold is momentary), and the held
 * Group button outranking it.
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
import { groupGestureStore } from '$lib/stores/v6/groupGestureStore.svelte';
import { MOMENTARY_HOLD_MS } from '$lib/components/v6/tracks/TrackStrip/utils/momentaryPress';
import TrackStrip from '$lib/components/v6/tracks/TrackStrip.svelte';

const TRACK_INDEX = 2;
const TRACK = `tracks/${TRACK_INDEX}`;

function track(solo = false): TrackRecord {
	return {
		trackPath: TRACK,
		name: 'T',
		color: 0,
		mute: false,
		solo,
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

function pointer(type: string, id: number, x = 40, y = 100): PointerEvent {
	const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
	Object.defineProperty(ev, 'pointerId', { value: id });
	Object.defineProperty(ev, 'pointerType', { value: 'touch' });
	return ev as unknown as PointerEvent;
}

function mount() {
	const { container } = render(TrackStrip, { props: { trackIndex: TRACK_INDEX } });
	const card = container.querySelector<HTMLElement>('[data-debug="track-card"]');
	if (!card) throw new Error('strip rendered without its card');
	card.getBoundingClientRect = () =>
		({ height: 200, width: 80, top: 0, left: 0, right: 80, bottom: 200, x: 0, y: 0 }) as DOMRect;
	return { container, card };
}

function soloWrites(): number[] {
	return vi
		.mocked(send)
		.mock.calls.filter(([address]) => String(address).endsWith('/track/solo'))
		.map(([, args]) => (args as [string, number])[1]);
}

/** Two fingers down at `t0`, both up `holdMs` later. */
function chord(card: HTMLElement, now: ReturnType<typeof vi.spyOn>, holdMs: number) {
	now.mockReturnValue(1000);
	card.dispatchEvent(pointer('pointerdown', 1, 30));
	now.mockReturnValue(1030);
	card.dispatchEvent(pointer('pointerdown', 2, 50));
	now.mockReturnValue(1030 + holdMs);
	window.dispatchEvent(pointer('pointerup', 1, 30));
	window.dispatchEvent(pointer('pointerup', 2, 50));
}

let now: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	_resetForTests();
	vi.mocked(send).mockClear();
	groupGestureStore.cancel();
	now = vi.spyOn(performance, 'now');
});

afterEach(() => {
	cleanup();
	now.mockRestore();
	groupGestureStore.cancel();
});

describe('TrackStrip — two-finger solo', () => {
	it('a quick two-finger touch latches solo on', () => {
		replaceTree(1, [track(false)]);
		const { card } = mount();
		chord(card, now, 100);
		expect(soloWrites()).toEqual([1]);
	});

	it('a held two-finger touch is momentary: release puts it back', () => {
		replaceTree(1, [track(false)]);
		const { card } = mount();
		chord(card, now, MOMENTARY_HOLD_MS + 50);
		expect(soloWrites()).toEqual([1, 0]);
	});

	it('on a soloed track, a held touch is a momentary unsolo', () => {
		replaceTree(1, [track(true)]);
		const { card } = mount();
		chord(card, now, MOMENTARY_HOLD_MS + 50);
		expect(soloWrites()).toEqual([0, 1]);
	});

	it('solos at the second finger, before anything lifts', () => {
		replaceTree(1, [track(false)]);
		const { card } = mount();
		card.dispatchEvent(pointer('pointerdown', 1));
		expect(soloWrites()).toEqual([]);
		card.dispatchEvent(pointer('pointerdown', 2));
		expect(soloWrites()).toEqual([1]);
		window.dispatchEvent(pointer('pointerup', 1));
		window.dispatchEvent(pointer('pointerup', 2));
	});

	it('does not select the track (the first finger\'s tap is dropped)', () => {
		replaceTree(1, [track(false)]);
		const { card } = mount();
		chord(card, now, 100);
		const selects = vi
			.mocked(send)
			.mock.calls.filter(([address]) => String(address).includes('select'));
		expect(selects).toEqual([]);
	});

	it('with the Group button held, two fingers add the track to the group instead', () => {
		replaceTree(1, [track(false)]);
		groupGestureStore.start('tracks/0', 'Anchor');
		const { card } = mount();
		chord(card, now, 100);
		expect(soloWrites()).toEqual([]);
		expect(groupGestureStore.memberPaths.has(TRACK)).toBe(true);
	});

	it('tints the whole strip while soloed', () => {
		replaceTree(1, [track(true)]);
		const { container } = mount();
		expect(container.querySelector('.solo-tint')).not.toBeNull();
		expect(container.querySelector('.header-name.is-soloed')).not.toBeNull();
	});

	it('no tint when not soloed', () => {
		replaceTree(1, [track(false)]);
		const { container } = mount();
		expect(container.querySelector('.solo-tint')).toBeNull();
		expect(container.querySelector('.header-name.is-soloed')).toBeNull();
	});
});
