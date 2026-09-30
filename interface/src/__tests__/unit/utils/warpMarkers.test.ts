import { describe, it, expect } from 'vitest';
import {
	dragTarget,
	markerBounds,
	moveMarker,
	parseWarpMarkers,
	secToBeat,
	shownMarkers
} from '$lib/utils/clip/warpMarkers';

// A fresh warped clip as Live leaves it: start, end, and the hidden marker
// 1/32 beat past the end. Here 120 BPM: 2 beats a second.
const FRESH = [
	{ beat: 0, sec: 0 },
	{ beat: 8, sec: 4 },
	{ beat: 8 + 1 / 32, sec: 4 + 1 / 64 }
];

describe('warpMarkers', () => {
	it('parses beat/second pairs and drops a dangling value', () => {
		expect(parseWarpMarkers([0, 0, 4, 2, 9])).toEqual([
			{ beat: 0, sec: 0 },
			{ beat: 4, sec: 2 }
		]);
	});

	it('hides Live’s trailing marker and nothing else', () => {
		expect(shownMarkers(FRESH)).toEqual(FRESH.slice(0, 2));
		const two = [
			{ beat: 0, sec: 0 },
			{ beat: 4, sec: 2 }
		];
		expect(shownMarkers(two)).toEqual(two);
	});

	it('maps seconds to beats between markers and past either end', () => {
		const shown = [
			{ beat: 0, sec: 0 },
			{ beat: 4, sec: 1 }, // 4 beats a second here
			{ beat: 6, sec: 2 } // 2 beats a second here
		];
		expect(secToBeat(shown, 0.5)).toBeCloseTo(2);
		expect(secToBeat(shown, 1.5)).toBeCloseTo(5);
		expect(secToBeat(shown, 3)).toBeCloseTo(8);
		expect(secToBeat(shown, -0.25)).toBeCloseTo(-1);
		expect(secToBeat(shown.slice(0, 1), 1)).toBeNull();
	});

	it('holds a marker between its neighbors; the last has no ceiling', () => {
		const shown = [
			{ beat: 0, sec: 0 },
			{ beat: 4, sec: 2 },
			{ beat: 8, sec: 4 }
		];
		expect(markerBounds(shown, 1, 0.1)).toEqual({ min: 0.1, max: 7.9 });
		expect(markerBounds(shown, 2, 0.1).max).toBe(Infinity);
		expect(dragTarget(shown, 1, 5.1, 0.25, 0.1)).toBe(5);
		expect(dragTarget(shown, 1, 9, 0.25, 0.1)).toBeCloseTo(7.9);
	});

	it('moves the end marker and carries the hidden one with it', () => {
		const moved = moveMarker(FRESH, 8, 9);
		expect(moved[1]).toEqual({ beat: 9, sec: 4 });
		expect(moved[2].beat).toBeCloseTo(9 + 1 / 32);
		expect(moved[0]).toBe(FRESH[0]);
	});
});
