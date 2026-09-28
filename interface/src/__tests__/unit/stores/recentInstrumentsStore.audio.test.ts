/**
 * Tests for recentInstrumentsStore tracking audio-sample picks.
 *
 * Recent is a mixed list: instrument presets, capture/convert Simplers, and now
 * audio samples picked from the browser in audio-source mode. A sample carries
 * a `loadTarget` so re-selection replays it the same way (clip vs Simpler);
 * legacy capture/convert entries carry none and default to Simpler downstream.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { recentInstrumentsStore } from '$lib/stores/v6/recentInstrumentsStore.svelte';

describe('recentInstrumentsStore audio picks', () => {
	beforeEach(() => {
		recentInstrumentsStore.clear();
	});

	it('records a browser clip pick with its load target', () => {
		recentInstrumentsStore.addSample('Kick 01', '/samples/Drum/kick01.wav', 'browser', 'clip');
		const [preset] = recentInstrumentsStore.getAsPresets();
		expect(preset.kind).toBe('sample');
		expect(preset.filePath).toBe('/samples/Drum/kick01.wav');
		expect(preset.loadTarget).toBe('clip');
	});

	it('records a browser simpler pick with its load target', () => {
		recentInstrumentsStore.addSample('Pad', '/samples/Inst/pad.wav', 'browser', 'simpler');
		const [preset] = recentInstrumentsStore.getAsPresets();
		expect(preset.loadTarget).toBe('simpler');
	});

	it('omits loadTarget for legacy capture entries (defaults to Simpler downstream)', () => {
		recentInstrumentsStore.addSample('Take 1', '/captures/take1.wav', 'capture');
		const [preset] = recentInstrumentsStore.getAsPresets();
		expect(preset.kind).toBe('sample');
		expect(preset.loadTarget).toBeUndefined();
	});

	it('dedupes a sample by file path, moving it to the front', () => {
		recentInstrumentsStore.addSample('A', '/samples/a.wav', 'browser', 'clip');
		recentInstrumentsStore.addSample('B', '/samples/b.wav', 'browser', 'simpler');
		// Re-pick A — should move to front, not duplicate.
		recentInstrumentsStore.addSample('A', '/samples/a.wav', 'browser', 'simpler');
		const presets = recentInstrumentsStore.getAsPresets();
		const aEntries = presets.filter((p) => p.filePath === '/samples/a.wav');
		expect(aEntries).toHaveLength(1);
		expect(presets[0].filePath).toBe('/samples/a.wav');
		// The newer pick's target wins.
		expect(presets[0].loadTarget).toBe('simpler');
	});
});
