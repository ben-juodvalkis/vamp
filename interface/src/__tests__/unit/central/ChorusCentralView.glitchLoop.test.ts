/**
 * ChorusCentralView's GlitchLoop: its Dry/Wet (param 7, 0–100, read off the
 * running device 2026-10-06) and Feedback L (param 9, 0–120), in Pitch
 * Hack's old place.
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
import ChorusCentralView from '$lib/components/v6/central/views/ChorusCentralView.svelte';

const TRACK = 'tracks/0';
const GL = `${TRACK}/devices/0`;

function glitchLoop(mix: number, feedback = 0): DeviceRecord {
	const params = new SvelteMap<string, ParamRecord>();
	for (let i = 0; i < 10; i++) {
		const paramPath = `${GL}/params/${i}`;
		const [name, value, max] =
			i === 7 ? ['DryWet', mix, 100] : i === 9 ? ['Feedback L', feedback, 120] : [`P${i}`, 0, 100];
		params.set(paramPath, { paramPath, name, displayName: name, min: 0, max, value, unit: '' });
	}
	return { devicePath: GL, name: 'GlitchLoop', className: 'MxDeviceAudioEffect', params, properties: new SvelteMap() };
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

const sliderTitled = (container: HTMLElement, title: string) =>
	Array.from(container.querySelectorAll<HTMLElement>('[role="slider"]')).find((s) =>
		s.getAttribute('aria-label')?.startsWith(`${title}:`)
	);
const glitchSlider = (container: HTMLElement) => sliderTitled(container, 'GlitchLoop');

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('ChorusCentralView GlitchLoop', () => {
	it('shows GlitchLoop Dry/Wet (param 7) on a 0–100 slider', async () => {
		seed(glitchLoop(30));
		const { container } = render(ChorusCentralView);
		await tick();
		const s = glitchSlider(container);
		expect(s).toBeDefined();
		expect(s?.getAttribute('aria-valuenow')).toBe('30');
		expect(s?.getAttribute('aria-valuemax')).toBe('100');
	});

	it('shows GlitchLoop Feedback L (param 9) on a 0–120 slider', async () => {
		seed(glitchLoop(30, 46));
		const { container } = render(ChorusCentralView);
		await tick();
		const s = sliderTitled(container, 'Feedback');
		expect(s).toBeDefined();
		expect(s?.getAttribute('aria-valuenow')).toBe('46');
		expect(s?.getAttribute('aria-valuemax')).toBe('120');
	});

	it('no longer draws Pitch Hack controls', async () => {
		seed(glitchLoop(0));
		const { container } = render(ChorusCentralView);
		await tick();
		expect(container.querySelector('.pitch-hack-row')).toBeNull();
		expect(container.textContent).not.toContain('Pitch Hack');
	});
});
