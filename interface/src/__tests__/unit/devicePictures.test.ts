import { describe, expect, it } from 'vitest';
import { pictureStrokes, type PictureKind } from '$lib/components/v6/browser/devicePictures';

describe('device pictures follow their control', () => {
	it("Echo's rings multiply with feedback and spread with time", () => {
		expect(pictureStrokes('rings', 0.5, 1).length).toBeGreaterThan(pictureStrokes('rings', 0.5, 0).length);
		const radius = (x: number) => Number(/A([\d.]+)/.exec(pictureStrokes('rings', x, 0.5).at(-2)!.d)![1]);
		expect(radius(1)).toBeGreaterThan(radius(0));
	});

	it('Beat Repeat repeats more, Note Chance lets more through, the likelier they are', () => {
		expect(pictureStrokes('repeat', 1).length).toBeGreaterThan(pictureStrokes('repeat', 0).length);
		const through = (x: number) => pictureStrokes('chance', x).filter((s) => s.o > 0.5).length;
		expect(through(1)).toBeGreaterThan(through(0));
		expect(through(1)).toBeLessThan(12);
		expect(through(0)).toBeGreaterThan(0);
	});

	it("Echo's rings are the top half, standing on the bottom edge", () => {
		const arcs = pictureStrokes('rings', 0.5, 0.5).filter((s) => s.d.includes('A'));
		expect(arcs.every((s) => /^M[\d.]+,100A.* 0 0 1 [\d.]+,100$/.test(s.d))).toBe(true);
	});

	it("Velocity is a bar graph: one baseline, uneven tops even at no randomness, more uneven with it", () => {
		const bars = (x: number) => pictureStrokes('velocity', x).map((s) => s.d.match(/^M([\d.]+),([\d.]+)h[\d.]+v([\d.]+)/)!.slice(2).map(Number));
		const bottoms = (x: number) => bars(x).map(([top, h]) => Math.round((top + h) * 10) / 10);
		const spread = (x: number) => Math.max(...bars(x).map(([, h]) => h)) - Math.min(...bars(x).map(([, h]) => h));
		expect(new Set(bottoms(0)).size).toBe(1);
		expect(new Set(bottoms(1)).size).toBe(1);
		expect(spread(0)).toBeGreaterThan(10);
		expect(spread(1)).toBeGreaterThan(spread(0));
	});

	it('every kind draws, at every corner, and holds still for the same values', () => {
		const kinds: PictureKind[] = ['rings', 'waves', 'tremolo', 'drum', 'gate', 'comb', 'notches', 'stairs', 'shaper', 'stompbox', 'eqcurve', 'wheels', 'tail', 'stack', 'compress', 'ratio', 'repeat', 'scatter', 'smear', 'glitch', 'octaves', 'reverse', 'ringmod', 'chance', 'velocity', 'arp', 'chord'];
		for (const k of kinds)
			for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.5]]) {
				const strokes = pictureStrokes(k, x, y);
				expect(strokes.length, k).toBeGreaterThan(0);
				expect(strokes.every((s) => !s.d.includes('NaN')), k).toBe(true);
				expect(pictureStrokes(k, x, y)).toEqual(strokes);
			}
	});
});
