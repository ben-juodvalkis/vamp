import { describe, it, expect } from 'vitest';
import {
	trackIndexOf,
	regularTrackIndexOf,
	trackOf,
	parseSlotPath,
	parseClipPath
} from '$lib/utils/livePaths';

describe('livePaths', () => {
	it('trackIndexOf: tracks/N → N, master → -1, else null', () => {
		expect(trackIndexOf('tracks/4')).toBe(4);
		expect(trackIndexOf('master')).toBe(-1);
		expect(trackIndexOf('returns/0')).toBeNull();
		expect(trackIndexOf('tracks/-1')).toBeNull();
		expect(trackIndexOf('tracks/abc')).toBeNull();
		expect(trackIndexOf('tracks/2/devices/0')).toBeNull();
	});

	it('regularTrackIndexOf leaves master out', () => {
		expect(regularTrackIndexOf('tracks/0')).toBe(0);
		expect(regularTrackIndexOf('master')).toBeNull();
	});

	it('trackOf finds the track any path sits on', () => {
		expect(trackOf('tracks/3/devices/1/params/0')).toBe('tracks/3');
		expect(trackOf('master/devices/0')).toBe('master');
		expect(trackOf('returns/1')).toBe('returns/1');
		expect(trackOf('tracksx/1')).toBeNull();
	});

	it('parses slot and clip paths', () => {
		expect(parseSlotPath('tracks/2/slots/5')).toEqual({
			trackPath: 'tracks/2',
			trackIndex: 2,
			sceneIndex: 5,
			slotPath: 'tracks/2/slots/5'
		});
		expect(parseSlotPath('tracks/2/slots/5/clip')).toBeNull();
		expect(parseClipPath('tracks/2/slots/5/clip')).toEqual({
			trackPath: 'tracks/2',
			trackIndex: 2,
			sceneIndex: 5,
			slotPath: 'tracks/2/slots/5'
		});
		expect(parseClipPath('')).toBeNull();
		expect(parseClipPath('returns/0/slots/1/clip')).toBeNull();
	});
});
