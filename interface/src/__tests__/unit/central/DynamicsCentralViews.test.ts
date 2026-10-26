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
	it('Glue: Threshold over Output', () => {
		const { container } = render(GlueCentralView);
		expect(container.querySelectorAll('.glue-slider')).toHaveLength(2);
		expect(container.textContent).toContain('Threshold');
		expect(container.textContent).toContain('Output');
	});

	it('Gate: the Gate control', () => {
		const { container } = render(GateCentralView);
		expect(container.querySelector('.gate-body')).not.toBeNull();
	});

	it('Multiband: Ratio, Threshold and Output', () => {
		const { container } = render(MultibandCentralView);
		expect(container.querySelectorAll('.mb-slider')).toHaveLength(3);
		expect(container.textContent).toContain('Ratio');
	});

	it('Compressor: sidechain, Makeup and the module, without the other dynamics devices', () => {
		const { container } = render(CompressorCentralView);
		expect(container.querySelector('.sidechain-section')).not.toBeNull();
		expect(container.querySelector('.makeup-toggle')).not.toBeNull();
		expect(container.querySelector('.compressor-wrapper')).not.toBeNull();
		expect(container.querySelector('.glue-slider')).toBeNull();
		expect(container.querySelector('.mb-slider')).toBeNull();
	});

	it('Utility: the Gain', () => {
		const { container } = render(UtilityCentralView);
		expect(container.querySelectorAll('.utility-slider')).toHaveLength(1);
		expect(container.textContent).toContain('Gain');
	});
});
