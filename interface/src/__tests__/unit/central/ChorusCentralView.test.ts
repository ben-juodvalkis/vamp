/**
 * The Chorus view (2026-10-23). Off a drum track the Chorus XY is the FX
 * grid's tile in the Drum cell, and Blur, Comb and Phaser leave the Auto Pan
 * view for this one. On a drum track the family stays in the Auto Pan view,
 * which is what this view draws there.
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
import { replaceTree, _resetForTests, type TrackRecord } from '$lib/stores/v3/normalized.svelte';
import ChorusCentralView from '$lib/components/v6/central/views/ChorusCentralView.svelte';
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

const titles = (container: HTMLElement) => container.textContent ?? '';

beforeEach(() => {
	vi.clearAllMocks();
	_resetForTests();
});
afterEach(() => cleanup());

describe('Chorus view', () => {
	it('holds Blur, Comb and Phaser off a drum track, and the Auto Pan view drops them', async () => {
		seed('synth');
		const view = render(ChorusCentralView);
		await tick();
		expect(view.container.querySelector('[data-view="chorus"]')).not.toBeNull();
		expect(titles(view.container)).toContain('Phaser');
		expect(titles(view.container)).not.toContain('Tremolo');
		cleanup();

		const autoPan = render(AutoPanCentralView);
		await tick();
		expect(autoPan.container.querySelector('.autopan-layout.no-chorus')).not.toBeNull();
		expect(titles(autoPan.container)).not.toContain('Phaser');
		expect(titles(autoPan.container)).not.toContain('Chorus');
	});

	it('holds Blur, Comb and Phaser on an audio track filed under Drum', async () => {
		seed('drum', { hasMidiInput: false, hasAudioInput: true });
		const { container } = render(ChorusCentralView);
		await tick();
		expect(container.querySelector('[data-view="chorus"]')).not.toBeNull();
	});

	it('is the Auto Pan view, Chorus family included, on a drum track', async () => {
		seed('drum');
		const { container } = render(ChorusCentralView);
		await tick();
		expect(container.querySelector('[data-view="chorus"]')).toBeNull();
		expect(container.querySelector('.autopan-layout:not(.no-chorus)')).not.toBeNull();
		expect(titles(container)).toContain('Phaser');
		expect(titles(container)).toContain('Chorus');
	});
});
