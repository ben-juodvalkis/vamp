/**
 * SimplerLoopControl's Start/End braces on a touch display: a press grabs
 * the brace nearest to where it landed, within reach of either, anywhere
 * on the waveform. Before, each brace was its own 48px element: at the
 * sample's edges (where the braces sit by default) the track clipped half
 * of it away, and when the braces were close the End element covered the
 * Start one, so End always won.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import SimplerLoopControl from '$lib/components/v6/simpler/SimplerLoopControl.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const SIMPLER = `${TRACK}/devices/0`;
const START = `${SIMPLER}/params/3`;
const LENGTH = `${SIMPLER}/params/4`;
const WIDTH = 400;

function simpler(start: number, length: number): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	const values = [1, 0, 0, start, length, 0, 0, 0];
	values.forEach((value, i) => {
		const paramPath = `${SIMPLER}/params/${i}`;
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: 1, value, unit: '' });
	});
	return { devicePath: SIMPLER, name: 'Simpler', className: 'OriginalSimpler', params, properties: new SvelteMap() };
}

function seed(device: DeviceRecord) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap([[device.devicePath, device]]), slots: new SvelteMap()
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

/** Mount, give the track a 400px box, and drag 20px right from `x`. */
async function dragFrom(start: number, length: number, x: number) {
	const device = simpler(start, length);
	seed(device);
	const { container } = render(SimplerLoopControl, { device });
	await tick();
	const track = container.querySelector<HTMLElement>('.loop-track')!;
	track.getBoundingClientRect = () => ({ left: 0, top: 0, right: WIDTH, bottom: 100, width: WIDTH, height: 100, x: 0, y: 0, toJSON: () => ({}) });
	vi.mocked(send).mockClear();
	await fireEvent.pointerDown(track, { pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: 50 });
	await fireEvent.pointerMove(window, { pointerId: 1, clientX: x + 20, clientY: 50 });
	await fireEvent.pointerUp(window, { pointerId: 1, clientX: x + 20, clientY: 50 });
	const writes = (path: string) => vi.mocked(send).mock.calls
		.filter(([, args]) => Array.isArray(args) && args[0] === path)
		.map(([, args]) => (args as number[])[1]);
	return { start: writes(START), length: writes(LENGTH) };
}

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('SimplerLoopControl brace grab', () => {
	it('grabs Start 46px in from the sample head, where it sits by default', async () => {
		const w = await dragFrom(0, 1, 46);
		expect(w.start).toEqual([0.05]);
		expect(w.length).toEqual([0.95]);
	});

	it('grabs End 46px in from the sample tail', async () => {
		const w = await dragFrom(0, 1, WIDTH - 46);
		expect(w.start).toEqual([]);
		expect(w.length).toEqual([]); // already at 1; a rightward drag clamps there
		cleanup();
		const left = await dragFrom(0, 0.5, 154); // End line at 200px
		expect(left.start).toEqual([]);
		expect(left.length).toEqual([0.55]);
	});

	it('keeps the middle third of a narrow loop for moving the range', async () => {
		// 120px..210px: each brace reaches 30px inward.
		const w = await dragFrom(0.3, 0.225, 165);
		expect(w.start.length).toBe(1);
		expect(w.start[0]).toBeCloseTo(0.35);
		expect(w.length).toEqual([]);
		cleanup();
		const outside = await dragFrom(0.3, 0.225, 75); // 45px left of Start
		expect(outside.start.length).toBe(1);
		expect(outside.start[0]).toBeCloseTo(0.35);
		expect(outside.length[0]).toBeCloseTo(0.175);
	});

	it('lets close braces each be grabbed from outside, not always End', async () => {
		// Start at 160px, End at 200px.
		const nearStart = await dragFrom(0.4, 0.1, 150);
		expect(nearStart.start).toEqual([0.45]);
		cleanup();
		const nearEnd = await dragFrom(0.4, 0.1, 210);
		expect(nearEnd.start).toEqual([]);
		expect(nearEnd.length.length).toBe(1);
		expect(nearEnd.length[0]).toBeCloseTo(0.15);
		cleanup();
		const middle = await dragFrom(0.4, 0.1, 180);
		expect(middle.start.length).toBe(1);
		expect(middle.start[0]).toBeCloseTo(0.45);
		expect(middle.length).toEqual([]);
	});

	it('moves the whole range from the middle of the loop', async () => {
		const w = await dragFrom(0.1, 0.5, 160); // 40px..240px
		expect(w.start.length).toBe(1);
		expect(w.start[0]).toBeCloseTo(0.15);
		expect(w.length).toEqual([]);
	});
});
