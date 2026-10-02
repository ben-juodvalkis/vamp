/**
 * The convolution side's IR picture: Live's names, the 48 dB scale, the
 * Attack / Decay envelope and the time axis.
 */
import { describe, it, expect } from 'vitest';
import {
	ampHeight,
	categoryLabel,
	envelopeDb,
	irLabel,
	irShape,
	tickLabel,
	timeTicks
} from '$lib/components/v6/central/views/reverb/irDisplay';

describe('Live’s names', () => {
	it('read as words, a stereo pair by its "LR"', () => {
		expect(categoryLabel('Chambers_and_Large_Rooms')).toBe('Chambers and Large Rooms');
		expect(irLabel('Blue Room LR')).toEqual({ name: 'Blue Room', stereo: true });
		expect(irLabel('Ableton Studio Mid')).toEqual({ name: 'Ableton Studio Mid', stereo: false });
	});
});

describe('the scale and the envelope', () => {
	it('draws amplitude over 48 dB', () => {
		expect(ampHeight(1)).toBe(1);
		expect(ampHeight(Math.pow(10, -24 / 20))).toBeCloseTo(0.5, 9);
		expect(ampHeight(Math.pow(10, -60 / 20))).toBe(0);
		expect(ampHeight(0)).toBe(0);
	});

	it('fades in over Attack and falls 60 dB over Decay', () => {
		expect(envelopeDb(0.25, 0.5, 1e9)).toBeCloseTo(-6.02, 1);
		expect(envelopeDb(0.6, 0.5, 1e9)).toBeCloseTo(0, 6);
		expect(envelopeDb(2, 0, 2)).toBeCloseTo(-60, 9);
		expect(envelopeDb(1, 0, 2)).toBeCloseTo(-30, 9);
	});
});

describe('the time axis', () => {
	it('picks three to six round ticks from 0', () => {
		expect(timeTicks(4.4)).toEqual([0, 1, 2, 3, 4]);
		expect(timeTicks(1.8)).toEqual([0, 0.5, 1, 1.5]);
		expect(timeTicks(0.3)).toEqual([0, 0.1, 0.2, 0.3]);
		expect(tickLabel(0)).toBe('0');
		expect(tickLabel(0.5)).toBe('500 ms');
		expect(tickLabel(2)).toBe('2 s');
	});
});

describe('irShape', () => {
	const flat: [number, number][] = Array.from({ length: 8 }, () => [-0.5, 0.5]);

	it('spans the IR as Size stretches it', () => {
		expect(irShape([flat], 2, 1.5, 0, 20, true).span).toBe(3);
	});

	it('leaves the IR alone with shaping off', () => {
		const s = irShape([flat, flat], 2, 1, 1, 0.5, false);
		expect(s.shaped).toEqual(s.raw);
		expect(s.envelope).toBeNull();
	});

	it('takes the start down with Attack and the end down with Decay', () => {
		const s = irShape([flat], 2, 1, 1, 2, true);
		const raw = s.raw[0];
		const shaped = s.shaped[0];
		expect(shaped[0]).toBeLessThan(raw[0] - 0.2);
		expect(shaped[7]).toBeLessThan(raw[7] - 0.4);
		expect(Math.max(...s.envelope!)).toBeLessThanOrEqual(1);
	});
});
