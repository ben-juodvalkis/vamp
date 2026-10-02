/**
 * The Reverb view's tail picture: every control has to move the picture
 * the way it moves the sound. Each test draws one input and one change,
 * and reads the ridges where that change should show.
 */
import { describe, it, expect } from 'vitest';
import {
	RIDGE_COUNT,
	SAMPLE_X,
	TIME_TICKS,
	tailPortrait,
	timeToX,
	wetPathDb,
	xToTime,
	type Ridge,
	type TailInput
} from '$lib/components/v6/central/views/reverb/tailPortrait';

const BASE: TailInput = {
	algo: 'darkHall',
	decay: 3.5,
	onset: 0.01,
	echoSpacing: 0.01,
	feedback: 0,
	size: 0.5,
	damping: 0,
	diffusion: 1,
	mod: 0,
	shape: 1,
	bassMult: 1,
	bassX: 440,
	lowDamp: 0,
	distance: 0.5,
	shimmer: 0.5,
	pitch: 12,
	tide: 0.5,
	tidePeriod: 0.5,
	wave: 0.5,
	lowMult: 1,
	highMult: 1,
	xOver: 800,
	freeze: false,
	wet: 1,
	levelDb: () => 0,
	vintage: 0
};

const draw = (change: Partial<TailInput>) => tailPortrait({ ...BASE, ...change });
/** Ridges come back to front; this is the band at `i` from the bottom. */
const band = (p: ReturnType<typeof tailPortrait>, i: number): Ridge => p.ridges[RIDGE_COUNT - 1 - i];
const top = RIDGE_COUNT - 1;
/** x of the last sample where the band still sounds. */
function endX(r: Ridge): number {
	for (let j = r.ys.length - 1; j >= 0; j--) if (r.ys[j] > r.base + 1e-4) return SAMPLE_X[j];
	return 0;
}
/** x of the first sample where the band sounds. */
function startX(r: Ridge): number {
	const j = r.ys.findIndex((y) => y > r.base + 1e-4);
	return j < 0 ? 1 : SAMPLE_X[j];
}
/** How often the ridge turns from rising to falling: its texture. */
function peaks(r: Ridge, untilX = 1): number {
	let n = 0;
	for (let j = 1; j < r.ys.length - 1 && SAMPLE_X[j] <= untilX; j++) {
		if (r.ys[j] > r.ys[j - 1] + 1e-4 && r.ys[j] > r.ys[j + 1] + 1e-4) n++;
	}
	return n;
}

describe('the time axis', () => {
	it('inverts, and puts 100 ms, 1 s and 10 s in order with Live’s middle Decay mid-picture', () => {
		for (const s of [0, 0.01, 0.1, 1, 3.5, 60]) expect(xToTime(timeToX(s))).toBeCloseTo(s, 9);
		const xs = TIME_TICKS.map((t) => timeToX(t.seconds));
		expect(xs).toEqual([...xs].sort((a, b) => a - b));
		expect(timeToX(3.5)).toBeGreaterThan(0.5);
		expect(timeToX(3.5)).toBeLessThan(0.62);
		expect(timeToX(60)).toBeLessThanOrEqual(1);
	});
});

describe('the tail', () => {
	it('ends where the Decay does, and the handle sits there', () => {
		const p = draw({});
		const mid = band(p, 7);
		expect(Math.abs(endX(mid) - p.tailEndX)).toBeLessThan(0.02);
		expect(p.tailEndX).toBeCloseTo(timeToX(0.01 + 3.5), 9);
	});

	it('runs longer with a longer Decay', () => {
		expect(endX(band(draw({ decay: 10 }), 7))).toBeGreaterThan(endX(band(draw({ decay: 1 }), 7)) + 0.1);
	});

	it('starts after the Predelay and the Delay', () => {
		const late = draw({ onset: 0.4 });
		expect(startX(band(late, 3))).toBeGreaterThanOrEqual(timeToX(0.4) - 0.005);
		expect(startX(band(draw({}), 3))).toBeLessThan(timeToX(0.4));
	});

	it('holds to the edge when frozen', () => {
		const p = draw({ freeze: true });
		for (const r of p.ridges) expect(endX(r)).toBe(1);
	});

	it('is gone at 0 % wet, leaving the dry hit at full height', () => {
		const dry = draw({ wet: 0 });
		for (const r of dry.ridges) for (const y of r.ys) expect(y).toBeCloseTo(r.base, 9);
		expect(dry.dry).toBeGreaterThan(0.5);
		expect(draw({ wet: 1 }).dry).toBe(0);
	});

	it('grows taller with more wet', () => {
		const peak = (p: ReturnType<typeof tailPortrait>) => Math.max(...band(p, 0).ys);
		expect(peak(draw({ wet: 0.8 }))).toBeGreaterThan(peak(draw({ wet: 0.2 })));
	});

	it('is the same picture every time', () => {
		expect(draw({ algo: 'tides', wave: 0.1 })).toEqual(draw({ algo: 'tides', wave: 0.1 }));
	});
});

describe('tone', () => {
	it('Damping ends the highs before the lows', () => {
		const p = draw({ damping: 1 });
		expect(endX(band(p, top))).toBeLessThan(endX(band(p, 0)) - 0.05);
		const open = draw({ damping: 0 });
		expect(Math.abs(endX(band(open, top)) - endX(band(open, 0)))).toBeLessThan(0.02);
	});

	it('Dark Hall: Bass Mult rings the lows below Bass X past the Decay, or cuts them short', () => {
		const long = draw({ bassMult: 4 });
		expect(endX(band(long, 0))).toBeGreaterThan(long.tailEndX + 0.05);
		expect(endX(band(long, top))).toBeLessThan(long.tailEndX + 0.02);
		const short = draw({ bassMult: 0.25 });
		expect(endX(band(short, 0))).toBeLessThan(short.tailEndX - 0.05);
		expect(long.crossover?.hz).toBe(440);
	});

	it('Quartz: Lo Damp ends the lows early', () => {
		const p = draw({ algo: 'quartz', lowDamp: 1 });
		expect(endX(band(p, 0))).toBeLessThan(endX(band(p, 7)) - 0.05);
	});

	it('Prism: the mults split the bands at the X-Over', () => {
		const p = draw({ algo: 'prism', lowMult: 3, highMult: 0.3, xOver: 800 });
		expect(endX(band(p, 0))).toBeGreaterThan(endX(band(p, top)) + 0.2);
		expect(p.crossover?.hz).toBe(800);
		expect(draw({ algo: 'shimmer' }).crossover).toBeNull();
	});

	it('the EQ’s low cut sinks the lowest band', () => {
		const cut = wetPathDb({
			eqOn: true, loType: 0, loHz: 200, loGainDb: 0, loSlopeDb: 24, peaks: [],
			hiType: 1, hiHz: 5000, hiGainDb: 0, hiSlopeDb: 12, send: 1
		});
		expect(cut(60)).toBeLessThan(-30);
		expect(Math.abs(cut(1000))).toBeLessThan(0.5);
		const p = draw({ levelDb: cut });
		expect(Math.max(...band(p, 0).ys) - band(p, 0).base).toBeLessThan(Math.max(...band(p, 7).ys) - band(p, 7).base);
	});

	it('the EQ switched off, or Send at 0 dB, leaves the bands alone', () => {
		const off = wetPathDb({
			eqOn: false, loType: 0, loHz: 2000, loGainDb: 0, loSlopeDb: 96, peaks: [],
			hiType: 0, hiHz: 100, hiGainDb: 0, hiSlopeDb: 96, send: 1
		});
		expect(off(60)).toBe(0);
		expect(off(10000)).toBe(0);
	});

	it('Vintage Extreme takes the top bands away', () => {
		const p = draw({ vintage: 4 });
		expect(endX(band(p, top))).toBe(0);
		expect(endX(band(draw({ vintage: 0 }), top))).toBeGreaterThan(0.3);
	});
});

describe('texture', () => {
	it('Quartz: low Diffusion breaks the early tail into echoes', () => {
		const sparse = peaks(band(draw({ algo: 'quartz', diffusion: 0 }), 7), timeToX(0.5));
		const dense = peaks(band(draw({ algo: 'quartz', diffusion: 1 }), 7), timeToX(0.5));
		expect(sparse).toBeGreaterThan(dense + 3);
	});

	it('Tides ripples the tail, the more the higher Tide is', () => {
		const calm = peaks(band(draw({ algo: 'tides', tide: 0 }), 7));
		const rough = peaks(band(draw({ algo: 'tides', tide: 1 }), 7));
		expect(rough).toBeGreaterThan(calm + 1);
	});

	it('Feedback repeats the tail at the Predelay', () => {
		const p = draw({ onset: 0.2, echoSpacing: 0.2, feedback: 0.9, decay: 0.3 });
		expect(endX(band(p, 7))).toBeGreaterThan(endX(band(draw({ onset: 0.2, echoSpacing: 0.2, decay: 0.3 }), 7)) + 0.1);
	});
});

describe('Shimmer’s climb', () => {
	const rising = (pts: { x: number; y: number }[]) => pts.every((p, i) => i === 0 || (p.x > pts[i - 1].x && p.y > pts[i - 1].y));
	const falling = (pts: { x: number; y: number }[]) => pts.every((p, i) => i === 0 || (p.x > pts[i - 1].x && p.y < pts[i - 1].y));

	it('rises for a pitch up and falls for a pitch down', () => {
		const up = draw({ algo: 'shimmer', pitch: 12 }).climb!;
		expect(up.length).toBeGreaterThan(2);
		expect(rising(up)).toBe(true);
		const down = draw({ algo: 'shimmer', pitch: -12 }).climb!;
		expect(falling(down)).toBe(true);
	});

	it('goes further the more Shimmer there is, and is only Shimmer’s', () => {
		expect(draw({ algo: 'shimmer', shimmer: 1, pitch: 5 }).climb!.length).toBeGreaterThan(
			draw({ algo: 'shimmer', shimmer: 0.2, pitch: 5 }).climb?.length ?? 0
		);
		expect(draw({ algo: 'darkHall' }).climb).toBeNull();
		expect(draw({ algo: 'shimmer', shimmer: 0 }).climb).toBeNull();
	});
});
