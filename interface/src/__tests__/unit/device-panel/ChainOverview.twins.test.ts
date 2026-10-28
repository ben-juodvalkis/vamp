/**
 * Two of one device on a track are two chain cells, and each cell's slider
 * is its own device's. The Rand Oct and Bass tiles dropped the device their
 * cell handed them and resolved the type's slot instead, so both cells read
 * and wrote the same device: a slide on one moved both (2026-10-27).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
// The stores before the grid (see BassControl.test.ts).
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import ChainOverview from '$lib/components/v6/device-panel/ChainOverview.svelte';
import {
	_resetForTests,
	replaceTree,
	type DeviceRecord,
	type ParamRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';

function device(index: number, name: string, className: string): DeviceRecord {
	const devicePath = `${TRACK}/devices/${index}`;
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 12; i++) {
		const paramPath = `${devicePath}/params/${i}`;
		// Device On, and everything else at rest.
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: 1, value: i === 0 ? 1 : 0, unit: '' });
	}
	return { devicePath, name, className, params, properties: new SvelteMap() };
}

function track(devices: DeviceRecord[], midi: boolean): TrackRecord {
	return {
		trackPath: TRACK, name: 'Keys', color: 0x36a2ff, mute: false, solo: false, arm: false,
		hasMidiInput: midi, hasAudioInput: !midi, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'synth',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
}

async function slideSecond(devices: DeviceRecord[], midi: boolean) {
	replaceTree(3, [track(devices, midi)]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
	const { container } = render(ChainOverview, { props: {} });
	await tick();
	const sliders = Array.from(container.querySelectorAll<HTMLElement>('.chain-cell .slider-container'));
	expect(sliders).toHaveLength(2);
	const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
	await fireEvent.pointerDown(sliders[1], { clientX: 50, clientY: 150, pointerId: 1 });
	await fireEvent.pointerMove(sliders[1], { clientX: 50, clientY: 50, pointerId: 1 });
	await frame();
	await fireEvent.pointerUp(sliders[1], { clientX: 50, clientY: 50, pointerId: 1 });
	await tick();
	const writes = vi
		.mocked(send)
		.mock.calls.filter(([address]) => address === '/looping/v3/param/set')
		.map(([, args]) => String((args as unknown[])[0]));
	const fills = sliders.map((s) => s.innerHTML.match(/height: ([0-9.]+)%/)?.[1]);
	return { writes, fills };
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 200, width: 100, height: 200, toJSON: () => ({})
	} as DOMRect);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('two of one device in the chain', () => {
	it.each([
		['Rand Oct', 'Random', 'MidiRandom', true],
		['Bass', 'Bass Amp', 'AudioEffectGroupDevice', false],
		['Saturator', 'Saturator', 'Saturator', false]
	])('a slide on the second %s writes and moves only that one', async (_label, name, className, midi) => {
		const { writes, fills } = await slideSecond(
			[device(0, name, className), device(1, name, className)],
			midi
		);
		expect(writes.length).toBeGreaterThan(0);
		expect(writes.every((p) => p.startsWith(`${TRACK}/devices/1/`))).toBe(true);
		expect(Number(fills[1])).toBeGreaterThan(0);
		expect(Number(fills[0])).toBe(0);
	});
});
