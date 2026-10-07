/**
 * EQCentralView's bloom: oeksound bloom's Amount and four band levels
 * (params 1–5, each 0..1, read off the running plug-in 2026-10-06:
 * "amount", "level 1 (main/ch1)" … "level 4 (main/ch1)").
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord, type DeviceRecord, type ParamRecord } from '$lib/stores/v3/normalized.svelte';
import EQCentralView from '$lib/components/v6/central/views/EQCentralView.svelte';

const TRACK = 'tracks/0';
const BLOOM = `${TRACK}/devices/0`;
const NAMES = ['Device On', 'amount', 'level 1 (main/ch1)', 'level 2 (main/ch1)', 'level 3 (main/ch1)', 'level 4 (main/ch1)'];

function bloom(values: number[]): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	NAMES.forEach((name, i) => {
		const paramPath = `${BLOOM}/params/${i}`;
		params.set(paramPath, { paramPath, name, displayName: name, min: 0, max: 1, value: i === 0 ? 1 : values[i - 1], unit: '' });
	});
	return { devicePath: BLOOM, name: 'bloom', className: 'AuPluginDevice', params, properties: new SvelteMap() };
}

function seed(devices: DeviceRecord[]) {
	const t: TrackRecord = {
		trackPath: TRACK, name: 'Keys', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap(devices.map((d) => [d.devicePath, d])), slots: new SvelteMap()
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

const sliders = (container: HTMLElement) =>
	Object.fromEntries(
		Array.from(container.querySelectorAll<HTMLElement>('.bloom-group [role="slider"]')).map((s) => [
			s.getAttribute('aria-label')?.split(':')[0],
			s
		])
	);

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('EQCentralView bloom', () => {
	it('draws Amount, Lo, Mid, Hi Mid and Hi from params 1–5', async () => {
		seed([bloom([0.2, 0.3, 0.4, 0.6, 0.7])]);
		const { container } = render(EQCentralView);
		await tick();
		const s = sliders(container);
		expect(Object.keys(s)).toEqual(['Amount', 'Lo', 'Mid', 'Hi Mid', 'Hi']);
		expect(['Amount', 'Lo', 'Mid', 'Hi Mid', 'Hi'].map((k) => s[k].getAttribute('aria-valuenow'))).toEqual(
			['0.2', '0.3', '0.4', '0.6', '0.7']
		);
		expect(container.querySelector('.bloom-group')?.classList.contains('slot-ghost')).toBe(false);
	});

	it('dims bloom as a ghost when the track has none', async () => {
		seed([]);
		const { container } = render(EQCentralView);
		await tick();
		expect(container.querySelector('.bloom-group')?.classList.contains('slot-ghost')).toBe(true);
		const s = sliders(container);
		expect(Object.keys(s)).toHaveLength(5);
		// Unloaded, Amount draws 0 and the bands sit flat at the centre.
		expect(['Amount', 'Lo', 'Mid', 'Hi Mid', 'Hi'].map((k) => s[k].getAttribute('aria-valuenow'))).toEqual(
			['0', '0.5', '0.5', '0.5', '0.5']
		);
	});
});
