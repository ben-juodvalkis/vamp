/**
 * GuitarCentralView's Dirty/Clean switch: macro 8 of the Guitar rack drives
 * a chain selector between two TONE3000 chains, and Live labels it 0 below
 * the midpoint and 1 above (device dump of the running rack, 2026-10-01:
 * `0=0 31.75=0 63.5=1 95.25=1 127=1`). So it is two buttons, not a slider:
 * Dirty writes 0, Clean writes 127. A rack whose macro 8 is not named for
 * it keeps the plain slider.
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
import GuitarCentralView from '$lib/components/v6/central/views/GuitarCentralView.svelte';
import { send } from '$lib/api/simpleClient';

const TRACK = 'tracks/0';
const GTR = `${TRACK}/devices/0`;
const NAMES = ['Device On', 'Gain', 'Drive', 'Fuzz', 'Spring', 'Tremolo Rate', 'Tremolo Amount', 'Room'];

function guitarRack(macro8Name: string, macro8Value: number): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	[...NAMES, macro8Name].forEach((name, i) => {
		const paramPath = `${GTR}/params/${i}`;
		params.set(paramPath, {
			paramPath, name, displayName: name,
			min: 0, max: i === 0 ? 1 : 127, value: i === 8 ? macro8Value : 0, unit: ''
		});
	});
	return { devicePath: GTR, name: 'Guitar', className: 'AudioEffectGroupDevice', params, properties: new SvelteMap() };
}

function seed(device: DeviceRecord) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Guitar', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: false, hasAudioInput: true, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap([[device.devicePath, device]]), slots: new SvelteMap()
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
	return Array.from(container.querySelectorAll<HTMLButtonElement>('.tone-btn')).find(
		(b) => b.textContent?.trim() === label
	);
}

function macro8Writes(): unknown[] {
	return vi.mocked(send).mock.calls
		.filter(([, args]) => Array.isArray(args) && args.includes(`${GTR}/params/8`))
		.map(([, args]) => (args as unknown[])[1]);
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('GuitarCentralView Dirty/Clean', () => {
	it('lights Dirty at 0 and writes 127 for Clean', async () => {
		seed(guitarRack('Dirty/Clean', 0));
		const { container } = render(GuitarCentralView);
		await tick();
		expect(button(container, 'Dirty')?.getAttribute('aria-pressed')).toBe('true');
		expect(button(container, 'Clean')?.getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(button(container, 'Clean')!);
		expect(macro8Writes()).toEqual([127]);
	});

	it('lights Clean in the upper half and writes 0 for Dirty', async () => {
		seed(guitarRack('Dirty/Clean', 127));
		const { container } = render(GuitarCentralView);
		await tick();
		expect(button(container, 'Clean')?.getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(button(container, 'Dirty')!);
		expect(macro8Writes()).toEqual([0]);
	});

	it('keeps a slider for a macro 8 named for something else', async () => {
		seed(guitarRack('Shimmer', 0));
		const { container } = render(GuitarCentralView);
		await tick();
		expect(container.querySelector('.tone-btn')).toBeNull();
		expect(container.querySelector('[role="slider"][aria-label^="Shimmer"]')).not.toBeNull();
	});
});
