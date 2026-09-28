/**
 * DrumBussCentralView (ADR-431): what the Drum tile opens — the Comp
 * switch and the Boom XY. Ghost until the track carries a Drum Buss; a
 * touch on the ghost loads it; the switch writes param 1 the other way.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { send } from '$lib/api/simpleClient';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { DEVICE_PRESETS } from '$lib/config/devicePresets';
import {
	replaceTree,
	_resetForTests,
	type TrackRecord,
	type DeviceRecord,
	type ParamRecord
} from '$lib/stores/v3/normalized.svelte';
import DrumBussCentralView from '$lib/components/v6/central/views/DrumBussCentralView.svelte';

const sendMock = vi.mocked(send);
const TRACK = 'tracks/0';
const DEVICE = `${TRACK}/devices/0`;

function drumBuss(values: Record<number, number>): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i <= 13; i++) {
		const paramPath = `${DEVICE}/params/${i}`;
		params.set(paramPath, { paramPath, name: `P${i}`, displayName: `P${i}`, min: 0, max: 1, value: values[i] ?? 0, unit: '' });
	}
	return { devicePath: DEVICE, name: 'Drum Buss', className: 'DrumBuss', params, properties: new SvelteMap() };
}

function track(devices: DeviceRecord[]): TrackRecord {
	return {
		trackPath: TRACK, name: 'Drums', color: 0xff3636, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: 'drum',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
}

function seed(devices: DeviceRecord[]) {
	replaceTree(3, [track(devices)]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('DrumBussCentralView', () => {
	it('draws the Comp switch and the Boom pad, lit from the device', async () => {
		seed([drumBuss({ 1: 1, 8: 0.7, 9: 0.3 })]);
		const { container } = render(DrumBussCentralView);
		await tick();
		const comp = container.querySelector<HTMLButtonElement>('.comp-toggle');
		expect(comp?.textContent?.trim()).toBe('Comp');
		expect(comp?.classList.contains('active')).toBe(true);
		expect(container.textContent).toContain('Boom');
		expect(container.querySelector('.drum-buss-layout')?.classList.contains('slot-ghost')).toBe(false);
	});

	it('switches the compressor off and on through param 1', async () => {
		seed([drumBuss({ 1: 1 })]);
		const { container } = render(DrumBussCentralView);
		await tick();
		await fireEvent.click(container.querySelector('.comp-toggle')!);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/param/set', [`${DEVICE}/params/1`, 0, 3]);
	});

	it('ghosts with no Drum Buss on the track, and a touch loads one', async () => {
		seed([]);
		const { container } = render(DrumBussCentralView);
		await tick();
		expect(container.querySelector('.drum-buss-layout')?.classList.contains('slot-ghost')).toBe(true);
		await fireEvent.click(container.querySelector('.comp-toggle')!);
		expect(sendMock).toHaveBeenCalledWith('/looping/v3/device/load', [TRACK, '', DEVICE_PRESETS.drum.presetPath]);
	});
});
