/**
 * Tests for browserModeStore's source axis + audio load target.
 *
 * The Audio rail button is no longer a category — it's the source axis that
 * re-skins every type button between instrument presets and audio samples. The
 * load-as switch (Clip | Simpler) decides what a picked sample becomes. Both
 * are persisted so the performer's last choice survives a reload. These tests
 * lock the default/toggle/persist contract the browser relies on.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { browserModeStore } from '$lib/stores/v6/browserModeStore.svelte';

describe('browserModeStore source axis', () => {
	beforeEach(() => {
		// Reset shared singleton + persisted keys between tests.
		browserModeStore.sourceMode = 'instruments';
		browserModeStore.audioLoadTarget = 'clip';
		browserModeStore.isInstrumentPersistent = false;
	});

	it('defaults to the instruments source', () => {
		expect(browserModeStore.sourceMode).toBe('instruments');
		expect(browserModeStore.isAudioSource).toBe(false);
	});

	it('toggles instruments ↔ audio', () => {
		browserModeStore.toggleSourceMode();
		expect(browserModeStore.sourceMode).toBe('audio');
		expect(browserModeStore.isAudioSource).toBe(true);
		browserModeStore.toggleSourceMode();
		expect(browserModeStore.sourceMode).toBe('instruments');
	});

	it('persists the source mode to localStorage', () => {
		browserModeStore.sourceMode = 'audio';
		expect(localStorage.getItem('browserModeStore.sourceMode')).toBe('audio');
		browserModeStore.sourceMode = 'instruments';
		expect(localStorage.getItem('browserModeStore.sourceMode')).toBe('instruments');
	});

	it('defaults the load target to clip and toggles to simpler', () => {
		expect(browserModeStore.audioLoadTarget).toBe('clip');
		browserModeStore.toggleAudioLoadTarget();
		expect(browserModeStore.audioLoadTarget).toBe('simpler');
		expect(localStorage.getItem('browserModeStore.audioLoadTarget')).toBe('simpler');
	});

	it('openAudioBrowser arms audio mode and opens the browser', () => {
		browserModeStore.openAudioBrowser();
		expect(browserModeStore.isAudioSource).toBe(true);
		expect(browserModeStore.isInstrumentPersistent).toBe(true);
		// Audio is the source axis now — no category trigger. The
		// `pendingVendorId` field this used to assert on was deleted
		// 2026-09-11: nothing ever wrote it a vendor id, so the DrillDown
		// `$effect` watching it could never fire.
	});

	it('openAudioBrowserForReplace arms audio mode + pins the clip target', () => {
		browserModeStore.openAudioBrowserForReplace(2, 5);
		expect(browserModeStore.isAudioSource).toBe(true);
		expect(browserModeStore.isReplacingAudioClip()).toBe(true);
		expect(browserModeStore.getAudioClipReplaceTarget()).toEqual({ trackIndex: 2, clipIndex: 5 });
		browserModeStore.clearAudioClipReplaceTarget();
	});
});

// The top-bar three-way switch (MIDI | Simpler | Audio) is a projection over the
// two persisted fields, not a fourth stored value. These lock the mapping the
// browser's setBrowseMode/browseMode rely on so a refactor can't silently drift.
describe('browserModeStore browseMode projection', () => {
	beforeEach(() => {
		browserModeStore.sourceMode = 'instruments';
		browserModeStore.audioLoadTarget = 'clip';
	});

	it('derives midi from the instruments source (load target ignored)', () => {
		browserModeStore.audioLoadTarget = 'simpler';
		expect(browserModeStore.browseMode).toBe('midi');
	});

	it('derives simpler / audio from the audio source by load target', () => {
		browserModeStore.sourceMode = 'audio';
		browserModeStore.audioLoadTarget = 'simpler';
		expect(browserModeStore.browseMode).toBe('simpler');
		browserModeStore.audioLoadTarget = 'clip';
		expect(browserModeStore.browseMode).toBe('audio');
	});

	it('setBrowseMode writes both underlying fields', () => {
		browserModeStore.setBrowseMode('simpler');
		expect(browserModeStore.sourceMode).toBe('audio');
		expect(browserModeStore.audioLoadTarget).toBe('simpler');

		browserModeStore.setBrowseMode('audio');
		expect(browserModeStore.sourceMode).toBe('audio');
		expect(browserModeStore.audioLoadTarget).toBe('clip');

		browserModeStore.setBrowseMode('midi');
		expect(browserModeStore.sourceMode).toBe('instruments');
	});

	it('setBrowseMode(midi) leaves the audio load target intact for next time', () => {
		browserModeStore.setBrowseMode('simpler');
		browserModeStore.setBrowseMode('midi');
		// Returning to a sample mode remembers the last load target.
		expect(browserModeStore.audioLoadTarget).toBe('simpler');
	});

	it('round-trips every mode through set → get', () => {
		for (const mode of ['midi', 'simpler', 'audio'] as const) {
			browserModeStore.setBrowseMode(mode);
			expect(browserModeStore.browseMode).toBe(mode);
		}
	});

	it('persists the underlying fields set via setBrowseMode', () => {
		browserModeStore.setBrowseMode('simpler');
		expect(localStorage.getItem('browserModeStore.sourceMode')).toBe('audio');
		expect(localStorage.getItem('browserModeStore.audioLoadTarget')).toBe('simpler');
	});
});
