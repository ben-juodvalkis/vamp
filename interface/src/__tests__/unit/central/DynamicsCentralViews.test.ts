/**
 * The dynamics views, one per device (ADR-478): the shared Squash view
 * split into Glue, Gate, Multiband and Compressor views, and the Utility
 * (the Gain tile's device) gained a view of its own. Each mounts with no
 * props and no device on the track — a ghost — and draws its controls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord } from '$lib/stores/v3/normalized.svelte';
import GlueCentralView from '$lib/components/v6/central/views/GlueCentralView.svelte';
import GateCentralView from '$lib/components/v6/central/views/GateCentralView.svelte';
import MultibandCentralView from '$lib/components/v6/central/views/MultibandCentralView.svelte';
import CompressorCentralView from '$lib/components/v6/central/views/CompressorCentralView.svelte';
import UtilityCentralView from '$lib/components/v6/central/views/UtilityCentralView.svelte';

const TRACK = 'tracks/0';

function seedEmptyTrack() {
	const record: TrackRecord = {
		trackPath: TRACK, name: 'Synth', color: 0xff3636, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role: '',
		devices: new SvelteMap(), slots: new SvelteMap()
	};
	replaceTree(3, [record]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
	seedEmptyTrack();
});

afterEach(() => cleanup());

describe('the dynamics views, one per device (ADR-478)', () => {
	it('Glue: the whole device but its external sidechain (2026-11-11)', () => {
		const { container } = render(GlueCentralView);
		const radios = (label: string) =>
			[...container.querySelectorAll(`[role="radiogroup"][aria-label="${label}"] [role="radio"]`)].map((b) => b.textContent);
		expect(radios('Ratio')).toEqual(['2:1', '4:1', '10:1']);
		expect(radios('Attack')).toEqual(['0.01', '0.1', '0.3', '1', '3', '10', '30']);
		expect(radios('Release')).toEqual(['0.1', '0.2', '0.4', '0.6', '0.8', '1.2', 'Auto']);
		for (const label of ['Threshold', 'Range', 'Makeup', 'Dry/Wet', 'Soft Clip', 'Sidechain EQ', 'Freq', 'Gain', 'Q']) {
			expect(container.textContent).toContain(label);
		}
	});

	it('Gate: the Gate control', () => {
		const { container } = render(GateCentralView);
		expect(container.querySelector('.gate-body')).not.toBeNull();
	});

	it('Multiband: the Mid band’s display, then Amount and Output (2026-11-08); no Ratio knob, that is its chain cell', () => {
		const { container } = render(MultibandCentralView);
		expect(container.querySelector('[data-band-display="Mid"]')).not.toBeNull();
		const knobs = [...container.querySelectorAll<HTMLElement>('.mb-knob')].map((k) => k.dataset.param);
		expect(knobs).toEqual(['Amount', 'Output']);
		expect(container.textContent).not.toContain('Ratio');
	});

	it('Compressor: sidechain, Makeup and the module, without the other dynamics devices', () => {
		const { container } = render(CompressorCentralView);
		expect(container.querySelector('.sidechain-section')).not.toBeNull();
		expect(container.querySelector('.makeup-toggle')).not.toBeNull();
		expect(container.querySelector('.compressor-wrapper')).not.toBeNull();
		expect(container.querySelector('[data-view="glue"]')).toBeNull();
		expect(container.querySelector('.mb-slider')).toBeNull();
	});

	it('Utility: Width, Balance, Bass Freq, the channel picker and the switches (Gain is the chain cell)', () => {
		const { container } = render(UtilityCentralView);
		expect(container.textContent).not.toContain('Gain');
		for (const label of ['Width', 'Balance', 'Bass Freq']) expect(container.textContent).toContain(label);
		const modes = [...container.querySelectorAll('[role="radio"]')];
		expect(modes.map((b) => b.textContent?.trim())).toEqual(['Left', 'Stereo', 'Right', 'Swap']);
		// A ghost shows Live's defaults: Stereo, every switch off.
		expect(modes[1].getAttribute('aria-checked')).toBe('true');
		const switches = [...container.querySelectorAll('button[aria-pressed]')];
		expect(switches.map((b) => b.textContent?.trim())).toEqual(['Mono', 'Bass Mono', 'Invert L', 'Invert R', 'DC Filter', 'Mute']);
		expect(switches.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
	});
});
