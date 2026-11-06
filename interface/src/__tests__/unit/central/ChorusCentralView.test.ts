/**
 * The Chorus family's views, one device each since the FX chain overview
 * took over from the grid (2026-10-26): the Chorus XY (ChorusCentralView),
 * Blur, Comb and Phaser. Until then the Chorus view drew Blur, Comb and
 * Phaser off a drum track, and the Auto Pan view all four on one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/api/simpleClient', () => ({ send: vi.fn() }));
vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup } from '@testing-library/svelte';
import { tick, type Component } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { selectedTrackStore, fxGrid } from '$lib/stores/v6/selectedTrackStore.svelte';
import { replaceTree, _resetForTests, type TrackRecord } from '$lib/stores/v3/normalized.svelte';
import ChorusCentralView from '$lib/components/v6/central/views/ChorusCentralView.svelte';
import BlurCentralView from '$lib/components/v6/central/views/BlurCentralView.svelte';
import CombCentralView from '$lib/components/v6/central/views/CombCentralView.svelte';
import PhaserCentralView from '$lib/components/v6/central/views/PhaserCentralView.svelte';
import AutoPanCentralView from '$lib/components/v6/central/views/AutoPanCentralView.svelte';

function seed(role: string, kind: Partial<TrackRecord> = {}) {
	const t: TrackRecord = {
		trackPath: 'tracks/0', name: 'T', color: 0xff8040, mute: false, solo: false, arm: false,
		hasMidiInput: true, hasAudioInput: false, hasArrangementClips: false,
		isFoldable: false, foldState: false, groupTrackIndex: -1, role,
		devices: new SvelteMap(), slots: new SvelteMap(), ...kind
	};
	replaceTree(3, [t]);
	selectedTrackStore.handleTrackSelected(0);
	fxGrid.resetForTrackChange();
}

const deviceControls = (container: HTMLElement) => container.querySelectorAll('.device-control').length;

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('Chorus family views', () => {
	it('draws its panel without the Chorus XY (the chain cell\'s), on a drum track or off one', async () => {
		for (const role of ['drum', 'synth']) {
			seed(role);
			const { container } = render(ChorusCentralView);
			await tick();
			expect(container.querySelector('[data-view="chorus"]'), role).not.toBeNull();
			expect(deviceControls(container), role).toBe(0);
			expect(container.textContent, role).toMatch(/Amount/);
			expect(container.textContent, role).not.toMatch(/Phaser|Comb|Tremolo/);
			cleanup();
		}
	});

	it('gives Blur, Comb and Phaser a view each; only Blur, a lone slider, repeats its chain cell\'s control', async () => {
		seed('synth');
		for (const [View, type, controls] of [[BlurCentralView, 'smudge', 1], [CombCentralView, 'comb', 0], [PhaserCentralView, 'phaser', 0]] as Array<[Component, string, number]>) {
			const { container } = render(View);
			await tick();
			expect(container.querySelector(`[data-view="${type}"]`), type).not.toBeNull();
			expect(deviceControls(container), type).toBe(controls);
			cleanup();
		}
	});

	it('leaves the Auto Pan view to Auto Pan, on a drum track too', async () => {
		seed('drum');
		const { container } = render(AutoPanCentralView);
		await tick();
		expect(container.textContent).toContain('Tremolo');
		expect(container.textContent).not.toMatch(/Phaser|Chorus|Comb/);
	});
});
