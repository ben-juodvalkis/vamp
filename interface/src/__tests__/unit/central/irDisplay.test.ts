/**
 * The convolution side's IR picture: Live's names, the 48 dB scale, the
 * Attack / Decay envelope and the time axis.
 */
import { describe, it, expect } from 'vitest';
import {
	IR_X0,
	IR_X1,
	ampHeight,
	attackAt,
	attackX,
	axisTicks,
	categoryLabel,
	decayAt,
	decayFloor,
	decayTop,
	decayY,
	envelopeDb,
	irLabel,
	irShape,
	louder,
	tickLabel,
	timeX,
	xTime
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
	it('spans the IR, round-trips, and gives the first milliseconds room', () => {
		expect(timeX(0, 4.4)).toBeCloseTo(IR_X0, 9);
		expect(timeX(4.4, 4.4)).toBeCloseTo(IR_X1, 9);
		for (const t of [0, 0.005, 0.05, 1, 4.4]) expect(xTime(timeX(t, 4.4), 4.4)).toBeCloseTo(t, 9);
		// 50 ms of a 4.4 s IR: about 1 % of a linear axis, about 8 % of this one.
		expect(timeX(0.05, 4.4) - IR_X0).toBeGreaterThan(0.07);
		// The same shape whatever the IR's length.
		expect(timeX(0.1, 1)).toBeCloseTo(timeX(1, 10), 9);
	});

	it('ticks round times that stand apart', () => {
		const ticks = axisTicks(2);
		expect(ticks[0]).toBe(0);
		expect(ticks.at(-1)).toBe(2);
		for (let i = 1; i < ticks.length; i++) expect(timeX(ticks[i], 2) - timeX(ticks[i - 1], 2)).toBeGreaterThanOrEqual(0.09);
		expect(tickLabel(0)).toBe('0');
		expect(tickLabel(0.05)).toBe('50 ms');
		expect(tickLabel(2)).toBe('2 s');
	});

	it('leaves room for every label on a narrow pad, and none off its edge', () => {
		// The Spring IR (4.14 s) on the iPad's 372 px pad: "100 ms" and
		// "200 ms" stood 36 px apart and read as one word.
		const span = 4.14;
		const width = 372;
		const ticks = axisTicks(span, width);
		expect(ticks).toContain(0.1);
		expect(ticks).not.toContain(0.2);
		for (let i = 1; i < ticks.length; i++) {
			const apart = (timeX(ticks[i], span) - timeX(ticks[i - 1], span)) * width;
			const room = ((tickLabel(ticks[i]).length + tickLabel(ticks[i - 1]).length) * 6.5) / 2 + 8;
			expect(apart).toBeGreaterThanOrEqual(room);
		}
		// A 500 ms IR's last round time sits on the right edge, where its
		// label would hang half off the pad.
		expect(axisTicks(0.5)).toContain(0.5);
		expect(axisTicks(0.5, width)).not.toContain(0.5);
	});
});

describe('the pad, fitted to the IR', () => {
	it('puts the Attack handle on the attack time, and keeps it to Live’s 3 s', () => {
		expect(attackX(0.5, 4.4)).toBeCloseTo(timeX(0.5, 4.4), 9);
		expect(attackAt(attackX(0.5, 4.4), 4.4)).toBeCloseTo(0.5, 9);
		expect(attackAt(1, 8.8)).toBe(3);
		expect(attackAt(0, 4.4)).toBe(0);
	});

	it('runs Decay logarithmically from a twentieth of the IR to four times it', () => {
		// A 250 ms IR at 100 %: 20 ms to 1 s — past 1 s the envelope barely touches it.
		expect(decayFloor(0.25)).toBe(0.02);
		expect(decayTop(0.25)).toBeCloseTo(1, 9);
		expect(decayAt(1, 0.25)).toBeCloseTo(1, 9);
		expect(decayAt(0, 0.25)).toBeCloseTo(0.02, 9);
		// The 4.4 s spring: 220 ms to 17.6 s; a long IR stops at Live's 20 s.
		expect(decayFloor(4.4)).toBeCloseTo(0.22, 9);
		expect(decayTop(4.4)).toBeCloseTo(17.6, 9);
		expect(decayTop(9)).toBe(20);
		for (const d of [0.3, 1, 6.2]) expect(decayAt(decayY(d, 4.4), 4.4)).toBeCloseTo(d, 9);
		// A Decay above the rail parks the handle at the top.
		expect(decayY(20, 0.25)).toBe(1);
	});
});

describe('one half for a stereo IR', () => {
	it('takes the louder of L and R at each moment', () => {
		expect(louder([[0.2, 0.9, 0.1], [0.5, 0.3, 0.1]])).toEqual([0.5, 0.9, 0.1]);
		expect(louder([[0.4, 0.6]])).toEqual([0.4, 0.6]);
		expect(louder([])).toEqual([]);
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
