/**
 * Tests for browserModeStore's replace-instrument target contract.
 *
 * Replace mode pins the swap to the track it was launched from
 * (ADR-390). The browser forwards `replaceInstrumentTargetPath` to
 * Python so the instrument swaps in place instead of spawning a new
 * track. These tests lock the capture/expose/clear lifecycle the
 * gesture handlers rely on — including the cleanup-on-exit contract
 * that prevents a stale pin from leaking into the next browser open.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { browserModeStore } from '$lib/stores/v6/browserModeStore.svelte';

describe('browserModeStore replace-instrument target', () => {
	beforeEach(() => {
		// Reset shared singleton state between tests.
		browserModeStore.exitReplaceMode();
		browserModeStore.clearAudioClipReplaceTarget();
		browserModeStore.isPersistent = false;
		browserModeStore.sourceMode = 'instruments';
	});

	it('captures the target track path when opening for replace', () => {
		browserModeStore.openForReplace('tracks/3');
		expect(browserModeStore.isReplacingInstrument).toBe(true);
		expect(browserModeStore.replaceInstrumentTargetPath).toBe('tracks/3');
		// Replace mode rides on persistent browse mode.
		expect(browserModeStore.isPersistent).toBe(true);
	});

	/**
	 * ADR-441. The patch is frozen with the pin and for the same reason: both
	 * describe the track as it stood when the hold fired, and the browser opens
	 * on the patch's catalog folder rather than wherever the last browse ended.
	 */
	it("captures the pinned track's patch alongside the pin", () => {
		browserModeStore.openForReplace('tracks/3', '/Library/Omni/Key/Grand/Ballad.aupreset');
		expect(browserModeStore.replaceInstrumentPresetPath).toBe(
			'/Library/Omni/Key/Grand/Ballad.aupreset'
		);
	});

	it("reads an unrecorded patch ('' or omitted) as no patch at all", () => {
		// The surface reports `''` for a track whose instrument is no longer the
		// one its last load left (Live's undo, a hot-swap) — not a path to open on.
		browserModeStore.openForReplace('tracks/3', '');
		expect(browserModeStore.replaceInstrumentPresetPath).toBeNull();
		browserModeStore.openForReplace('tracks/3');
		expect(browserModeStore.replaceInstrumentPresetPath).toBeNull();
	});

	it('clears the flag, the pinned path and the patch on exit', () => {
		browserModeStore.openForReplace('tracks/3', '/Library/Omni/Key/Grand/Ballad.aupreset');
		browserModeStore.exitReplaceMode();
		expect(browserModeStore.isReplacingInstrument).toBe(false);
		// Critical: a leaked pin would make the next normal open silently
		// re-enter replace mode and forward a stale path to Python.
		expect(browserModeStore.replaceInstrumentTargetPath).toBeNull();
		// And a leaked patch would land the next replace on the previous
		// track's folder.
		expect(browserModeStore.replaceInstrumentPresetPath).toBeNull();
	});

	it('tolerates opening for replace with no target (null pin)', () => {
		browserModeStore.openForReplace();
		expect(browserModeStore.isReplacingInstrument).toBe(true);
		expect(browserModeStore.replaceInstrumentTargetPath).toBeNull();
	});

	it('forces MIDI (instruments) source so the swap targets the pinned track', () => {
		// A replace can be launched after browsing in a sample mode (now that the
		// browse mode persists across opens). Instrument-replace must still open in
		// MIDI — an audio/Simpler pick would ignore the pin and spawn a new track.
		browserModeStore.sourceMode = 'audio';
		browserModeStore.openForReplace('tracks/3');
		expect(browserModeStore.sourceMode).toBe('instruments');
		expect(browserModeStore.isAudioSource).toBe(false);
	});

	it('keeps the two replace modes mutually exclusive (each open clears the other)', () => {
		browserModeStore.openForReplace('tracks/3', '/Library/Omni/Key/Grand/Ballad.aupreset');
		browserModeStore.openAudioBrowserForReplace(1, 2);
		// Audio-clip replace now owns the state; the instrument pin is gone.
		expect(browserModeStore.isReplacingAudioClip()).toBe(true);
		expect(browserModeStore.isReplacingInstrument).toBe(false);
		expect(browserModeStore.replaceInstrumentTargetPath).toBeNull();
		expect(browserModeStore.replaceInstrumentPresetPath).toBeNull();

		browserModeStore.openForReplace('tracks/5');
		// …and back: instrument replace clears the audio-clip target.
		expect(browserModeStore.isReplacingInstrument).toBe(true);
		expect(browserModeStore.isReplacingAudioClip()).toBe(false);
	});
});
