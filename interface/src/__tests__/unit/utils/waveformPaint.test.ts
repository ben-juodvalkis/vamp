/**
 * waveformPaint — the one canvas routine behind the clip preview, the clip
 * editor and the Simpler overview.
 *
 * The fixture that matters is the rig's Bass take, measured 2026-09-18: a
 * warped recording spanning beats 0..28, looping 16..24, whose Live
 * `length` reads 8 — the loop's length. Taking the file to span
 * `[0, length]` put the loop wholly past the end of the file and the strip
 * drew nothing; these pin that the time-based geometry finds it.
 */

import { describe, it, expect } from 'vitest';
import {
	clipViewWindow,
	paintPeaks,
	peakBinRange,
	peakSpan,
	type PeakPair
} from '$lib/utils/waveformPaint';

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
	fill: unknown;
}

function fakeCtx() {
	const rects: Rect[] = [];
	const ctx = {
		fillStyle: '' as unknown,
		fillRect(x: number, y: number, w: number, h: number) {
			rects.push({ x, y, w, h, fill: this.fillStyle });
		}
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

const flat = (n: number, amp = 0.5): PeakPair[] => Array.from({ length: n }, () => [-amp, amp]);

const BASS = {
	loopStartBeats: 16,
	loopEndBeats: 24,
	lengthBeats: 8,
	fileStartBeats: 0,
	fileEndBeats: 28
};

describe('peakSpan', () => {
	it('uses the reported span when it is known', () => {
		expect(peakSpan(0, 28, 8)).toEqual({ start: 0, end: 28 });
		expect(peakSpan(-4, 24, 8)).toEqual({ start: -4, end: 24 });
	});

	it('falls back to [0, fallbackEnd] when unknown (0, 0) or inverted', () => {
		expect(peakSpan(0, 0, 8)).toEqual({ start: 0, end: 8 });
		expect(peakSpan(5, 5, 8)).toEqual({ start: 0, end: 8 });
		expect(peakSpan(6, 2, 8)).toEqual({ start: 0, end: 8 });
	});
});

describe('clipViewWindow', () => {
	it('is the loop fields when looping', () => {
		expect(clipViewWindow(BASS)).toEqual({ start: 16, end: 24 });
	});

	it('is the loop fields when NOT looping too — Live reports the markers there', () => {
		// Unwarped Bass take, measured: loop_start = start_marker = 10.16 s,
		// loop_end = 17.78 s (the file's end). end_marker read 28.0 (beats).
		expect(
			clipViewWindow({
				loopStartBeats: 10.158730158730158,
				loopEndBeats: 17.77777777777778,
				lengthBeats: 12,
				fileStartBeats: 0,
				fileEndBeats: 17.77777777777778
			})
		).toEqual({ start: 10.158730158730158, end: 17.77777777777778 });
	});

	it('is the whole file when the loop fields are empty and the span is known', () => {
		// A session-grid cell that isn't playing: no loop fields reach it.
		expect(clipViewWindow({ ...BASS, loopStartBeats: 0, loopEndBeats: 0 })).toEqual({
			start: 0,
			end: 28
		});
	});

	it('is [0, length] when neither is known (MIDI cell, old surface)', () => {
		expect(
			clipViewWindow({
				loopStartBeats: 0,
				loopEndBeats: 0,
				lengthBeats: 8,
				fileStartBeats: 0,
				fileEndBeats: 0
			})
		).toEqual({ start: 0, end: 8 });
	});
});

describe('peakBinRange', () => {
	it('finds the Bass loop inside its 28-beat file', () => {
		expect(peakBinRange(256, { start: 0, end: 28 }, { start: 16, end: 24 })).toEqual({
			binStart: 146,
			binEnd: 220
		});
	});

	it('finds the Guitar loop (8..16 of a 16-beat file)', () => {
		expect(peakBinRange(256, { start: 0, end: 16 }, { start: 8, end: 16 })).toEqual({
			binStart: 128,
			binEnd: 256
		});
	});

	it('reproduces the bug under the old assumption: file taken as [0, length]', () => {
		// length 8, loop 16..24 → wholly past the "end" → nothing to draw.
		expect(peakBinRange(256, { start: 0, end: 8 }, { start: 16, end: 24 })).toBeNull();
		// Guitar: length 8, loop 8..16 → starts exactly at the "end".
		expect(peakBinRange(256, { start: 0, end: 8 }, { start: 8, end: 16 })).toBeNull();
	});

	it('clamps a view that runs past either end of the file', () => {
		expect(peakBinRange(100, { start: 0, end: 4 }, { start: -2, end: 8 })).toEqual({
			binStart: 0,
			binEnd: 100
		});
	});

	it('is null for an empty array or a degenerate range', () => {
		expect(peakBinRange(0, { start: 0, end: 4 }, { start: 0, end: 4 })).toBeNull();
		expect(peakBinRange(10, { start: 4, end: 4 }, { start: 0, end: 4 })).toBeNull();
		expect(peakBinRange(10, { start: 0, end: 4 }, { start: 2, end: 2 })).toBeNull();
	});
});

describe('paintPeaks', () => {
	const opts = { amplitude: 'perceptual' as const, headroom: 0.9, ink: () => '#fff' };

	it('draws the Bass loop across the whole canvas', () => {
		const { ctx, rects } = fakeCtx();
		paintPeaks(ctx, flat(256), 300, 100, {
			...opts,
			span: peakSpan(BASS.fileStartBeats, BASS.fileEndBeats, BASS.lengthBeats),
			view: clipViewWindow(BASS)
		});
		expect(rects.length).toBe(220 - 146);
		expect(Math.min(...rects.map((r) => r.x))).toBeLessThanOrEqual(0);
		expect(Math.max(...rects.map((r) => r.x + r.w))).toBeGreaterThanOrEqual(300);
	});

	it('draws nothing for the same take with the span unknown — the blank strip', () => {
		const { ctx, rects } = fakeCtx();
		paintPeaks(ctx, flat(256), 300, 100, {
			...opts,
			span: peakSpan(0, 0, BASS.lengthBeats),
			view: clipViewWindow({ ...BASS, fileStartBeats: 0, fileEndBeats: 0 })
		});
		expect(rects).toEqual([]);
	});

	it('places bars by time: a view past the file end leaves that part empty', () => {
		const { ctx, rects } = fakeCtx();
		paintPeaks(ctx, flat(40), 800, 100, {
			...opts,
			span: { start: 0, end: 4 },
			view: { start: 0, end: 8 }
		});
		expect(rects.length).toBe(40);
		expect(Math.max(...rects.map((r) => r.x + r.w))).toBe(400);
	});

	it('matches the old stretch exactly when the view is the span', () => {
		// round(i * width / n) on both edges — what ClipPreview and the
		// Simpler overview drew before, so a whole-file view is pixel-identical.
		const { ctx, rects } = fakeCtx();
		paintPeaks(ctx, flat(7), 100, 50, { ...opts, span: { start: 0, end: 1 }, view: { start: 0, end: 1 } });
		expect(rects.map((r) => r.x)).toEqual([0, 14, 29, 43, 57, 71, 86]);
		expect(rects.map((r) => r.w)).toEqual([14, 15, 14, 14, 14, 15, 14]);
	});

	it('hands ink the unrounded edges in canvas pixels', () => {
		const { ctx } = fakeCtx();
		const seen: [number, number][] = [];
		paintPeaks(ctx, flat(3), 100, 50, {
			...opts,
			span: { start: 0, end: 1 },
			view: { start: 0, end: 1 },
			ink: (x0, x1) => {
				seen.push([x0, x1]);
				return '#fff';
			}
		});
		expect(seen[1][0]).toBeCloseTo(100 / 3);
		expect(seen[1][1]).toBeCloseTo(200 / 3);
	});

	it('normalizes the loudest visible bar to the headroom in both curves', () => {
		for (const amplitude of ['perceptual', 'linear'] as const) {
			const { ctx, rects } = fakeCtx();
			paintPeaks(ctx, [[-0.1, 0.1]], 10, 100, {
				...opts,
				amplitude,
				span: { start: 0, end: 1 },
				view: { start: 0, end: 1 }
			});
			// mid 50, headroom 0.9 → ±45 → y 5..95.
			expect(rects[0].y).toBe(5);
			expect(rects[0].h).toBeCloseTo(90);
		}
	});

	it('lifts quiet material only under the perceptual curve', () => {
		const heights = (amplitude: 'perceptual' | 'linear') => {
			const { ctx, rects } = fakeCtx();
			paintPeaks(ctx, [[-1, 1], [-0.1, 0.1]], 20, 100, {
				...opts,
				amplitude,
				span: { start: 0, end: 1 },
				view: { start: 0, end: 1 }
			});
			return rects[1].h;
		};
		expect(heights('linear')).toBeCloseTo(9);
		expect(heights('perceptual')).toBeGreaterThan(20);
	});
});

describe('paintPeaks with a warp placement', () => {
	it('lays each bar where the markers put its slice of the file', () => {
		// 4 bins over a file whose first half plays over beats 0..1 and
		// second half over beats 1..4 (a marker at the midpoint, beat 1).
		const place = (f: number) => (f <= 0.5 ? f * 2 : 1 + (f - 0.5) * 6);
		const { ctx, rects } = fakeCtx();
		paintPeaks(ctx, flat(4), 400, 100, {
			span: { start: 0, end: 4 },
			view: { start: 0, end: 4 },
			place,
			amplitude: 'linear',
			headroom: 1,
			ink: () => 'ink'
		});
		expect(rects.map((r) => [r.x, r.w])).toEqual([
			[0, 50],
			[50, 50],
			[100, 150],
			[250, 150]
		]);
	});

	it('skips bars that fall outside the view', () => {
		const place = (f: number) => f * 8;
		const { ctx, rects } = fakeCtx();
		paintPeaks(ctx, flat(8), 100, 100, {
			span: { start: 0, end: 8 },
			view: { start: 2, end: 4 },
			place,
			amplitude: 'linear',
			headroom: 1,
			ink: () => 'ink'
		});
		expect(rects).toHaveLength(2);
		expect(rects[0].x).toBe(0);
	});
});
