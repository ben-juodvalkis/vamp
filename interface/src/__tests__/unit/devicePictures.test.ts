import { describe, expect, it } from 'vitest';
import { pictureStrokes, type PictureKind } from '$lib/components/v6/browser/devicePictures';

describe('device pictures follow their control', () => {
	it("Echo's rings multiply with feedback and spread with time", () => {
		expect(pictureStrokes('rings', 0.5, 1).length).toBeGreaterThan(pictureStrokes('rings', 0.5, 0).length);
		const radius = (x: number) => Number(/a([\d.]+)/.exec(pictureStrokes('rings', x, 0.5).at(-1)!.d)![1]);
		expect(radius(1)).toBeGreaterThan(radius(0));
	});

	it('Beat Repeat repeats more, Note Chance lets more through, the likelier they are', () => {
		expect(pictureStrokes('repeat', 1).length).toBeGreaterThan(pictureStrokes('repeat', 0).length);
		const through = (x: number) => pictureStrokes('chance', x).filter((s) => s.o > 0.5).length;
		expect(through(1)).toBe(12);
		expect(through(0)).toBe(0);
	});

	it('every kind draws, at every corner, and holds still for the same values', () => {
		const kinds: PictureKind[] = ['rings', 'waves', 'tremolo', 'transient', 'gate', 'comb', 'notches', 'stairs', 'shaper', 'clip', 'stompbox', 'compress', 'ratio', 'repeat', 'scatter', 'smear', 'glitch', 'octaves', 'ringmod', 'chance', 'velocity', 'arp', 'chord'];
		for (const k of kinds)
			for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.5]]) {
				const strokes = pictureStrokes(k, x, y);
				expect(strokes.length, k).toBeGreaterThan(0);
				expect(strokes.every((s) => !s.d.includes('NaN')), k).toBe(true);
				expect(pictureStrokes(k, x, y)).toEqual(strokes);
			}
	});
});
