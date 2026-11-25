import { describe, it, expect, beforeEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';
import { trackInkFor } from '$lib/utils/trackInkFor';
import { rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
import { paintModeReactive } from '$lib/utils/paintMode.svelte';
import { _resetForTests, replaceTree, type TrackRecord } from '$lib/stores/v3/normalized.svelte';
import { abbreviateScale } from '$lib/data/scaleAbbreviations';

function track(color: number): TrackRecord {
	return {
		trackPath: 'tracks/0',
		name: 'T',
		color,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		volume: 0.5,
		devices: new SvelteMap(),
		slots: new SvelteMap()
	};
}

describe('trackInkFor', () => {
	beforeEach(() => _resetForTests());

	it("inks the track's own colour", () => {
		replaceTree(1, [track(0xff3300)]);
		expect(trackInkFor('tracks/0')).toBe(trackInk(rgbToHex(0xff3300), paintModeReactive()));
	});

	it('is the uncoloured grey for a track with no record, or none', () => {
		const grey = trackInk(rgbToHex(0x808080), paintModeReactive());
		expect(trackInkFor('tracks/9')).toBe(grey);
		expect(trackInkFor(null)).toBe(grey);
	});
});

describe('abbreviateScale', () => {
	it('shortens a known scale and passes an unknown one through', () => {
		expect(abbreviateScale('Half-whole Dim.')).toBe('HW Dim');
		expect(abbreviateScale('Something New')).toBe('Something New');
	});
});
