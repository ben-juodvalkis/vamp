/**
 * Ben's Adaptive Tone Shaper in the EQ view: what the graph is made of.
 *
 * The device's own face is a graph (its `toneshaper_graph.js`): the input's
 * spectrum, the curve being applied, four tone handles that move up and down
 * for the level and sideways for the center, an Amount bar and two buttons.
 * This is the same graph for the iPad, in the same geometry: 25 Hz to
 * 20 kHz across on a log axis, ±12 dB up.
 */

/** Live's parameter indices, read off the running device (2026-10-07). */
export const TS_PARAM = {
	amount: 1,
	levels: [2, 3, 4, 5],
	latency: 6,
	quality: 7,
	hz: [8, 9, 10, 11]
} as const;

export const TS_BANDS = 59;
export const TS_F_LO = 25;
export const TS_F_HI = 20000;
/** The graph's half height in dB: +12 at the top, -12 at the bottom. */
export const TS_DB = 12;
export const TS_AMOUNT_MAX = 10;
export const TS_LEVEL_MAX = 10;

export const TS_HANDLE = [
	{ key: 'lows', name: 'Lows', range: [27, 350] as const, rest: 100 },
	{ key: 'lomids', name: 'Lo-mids', range: [62, 1000] as const, rest: 350 },
	{ key: 'himids', name: 'Hi-mids', range: [750, 10000] as const, rest: 3500 },
	{ key: 'highs', name: 'Highs', range: [2500, 20000] as const, rest: 6300 }
] as const;

export type HandleKey = (typeof TS_HANDLE)[number]['key'];

/** The center of sixth-octave band `b`: band 32 is 1 kHz. */
export function bandHz(b: number): number {
	return 1000 * Math.pow(2, (b - 32) / 6);
}

/** 0..1 across the graph, log in frequency. */
export function hzX(hz: number): number {
	return Math.log(hz / TS_F_LO) / Math.log(TS_F_HI / TS_F_LO);
}

/** The frequency at 0..1 across. */
export function xHz(x: number): number {
	return TS_F_LO * Math.pow(TS_F_HI / TS_F_LO, x);
}

/** 0..1 up the graph: 0 dB in the middle, ±12 at the edges. */
export function dbY(db: number): number {
	return 0.5 + Math.max(-TS_DB, Math.min(TS_DB, db)) / (2 * TS_DB);
}

export function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

/**
 * The spectrum, 0..1 up per band: the loudest band sits two thirds up and
 * sixty dB below it is the floor, as the device draws it.
 */
export function spectrumY(levels: number[]): number[] {
	const top = Math.max(...levels);
	return levels.map((l) => (0.66 * (Math.max(-60, l - top) + 60)) / 60);
}

/** A tone handle's center, as its label reads: "100 Hz", "350", "3.5k", "16k". */
export function hzLabel(hz: number, withUnit = false): string {
	const text = hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`;
	return withUnit && hz < 1000 ? `${text} Hz` : text;
}

/** A tone level as it reads: "+3.2", "-0.5", "0.0". */
export function levelLabel(level: number): string {
	return `${level > 0 ? '+' : ''}${level.toFixed(1)}`;
}

/**
 * The handle nearest a press, within reach, else none. Distances are in
 * pixels on the pad, so a handle is as easy to take whatever the pad's
 * aspect.
 */
export function nearestHandle(
	levels: number[],
	hz: number[],
	x: number,
	y: number,
	width: number,
	height: number,
	reachPx = 28
): number {
	let best = -1;
	let bestD = reachPx;
	for (let i = 0; i < TS_HANDLE.length; i++) {
		const dx = (x - hzX(hz[i])) * width;
		const dy = (y - dbY(levels[i])) * height;
		const d = Math.hypot(dx, dy);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

/**
 * What a drag of handle `i` writes: its level from the dB axis (the pad's
 * full height is the graph's 24 dB) and its center from the log axis, each
 * clamped to its own range.
 */
export function handleDrag(
	i: number,
	start: { level: number; hz: number },
	dx: number,
	dy: number,
	width: number,
	height: number
): { level: number; hz: number } {
	const level = clamp(start.level + (dy / height) * 2 * TS_DB, -TS_LEVEL_MAX, TS_LEVEL_MAX);
	const [lo, hi] = TS_HANDLE[i].range;
	const hz = clamp(xHz(hzX(start.hz) + dx / width), lo, hi);
	return { level, hz };
}

/** What a drag of the Amount bar writes: its full height is 0 to 10. */
export function amountDrag(start: number, dy: number, height: number): number {
	return clamp(start + (dy / height) * TS_AMOUNT_MAX, 0, TS_AMOUNT_MAX);
}
