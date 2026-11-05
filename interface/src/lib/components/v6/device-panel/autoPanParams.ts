/**
 * Auto Pan Legacy's parameter map (LOM class `AutoPan`), shared by the
 * grid tile and the central view so the two faces cannot disagree about
 * what a gesture writes.
 *
 * Indices, ranges and labels were read off the running device on
 * 2026-10-01 (Live 12 Beta, `str_for_value` per value):
 *
 *   1 LFO Type        quantized   0 Frequency (free) · 1 Beats (sync)
 *   2 Amount          0..1
 *   3 Frequency       0..1        Hz = 0.05 · 1800^v  (0.05 … 90 Hz)
 *   4 Sync Rate       0..21       SYNC_RATE_LABELS
 *   5 Phase           0..360
 *   9 Waveform        quantized   0 Sine · 1 Triangle · 2 SawDown · 3 S&H Width
 *  10 Shape           0..1
 *  11 Width (Random)  0..1
 *  12 Invert          quantized   0 Normal · 1 Inverted
 *
 * Every value here is raw Live units: the view writes them as is.
 */

export type ParamWrite = readonly [index: number, value: number];

export const AUTO_PAN = {
	lfoType: 1,
	amount: 2,
	frequency: 3,
	syncRate: 4,
	phase: 5,
	waveform: 9,
	shape: 10,
	width: 11,
	invert: 12
} as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Sync Rate's 22 steps as Live labels them, by value. */
export const SYNC_RATE_LABELS = [
	'1/64', '1/48', '1/32', '1/24', '1/16', '1/12', '1/8', '1/6', '3/16', '1/4', '5/16',
	'1/3', '3/8', '1/2', '3/4', '1', '1.5', '2', '3', '4', '6', '8'
] as const;
export const SYNC_RATE_MAX = SYNC_RATE_LABELS.length - 1;

export function syncRateLabel(value: number): string {
	const i = Math.max(0, Math.min(SYNC_RATE_MAX, Math.round(value)));
	return SYNC_RATE_LABELS[i];
}

/** Frequency's rail, measured: 0 → 0.05 Hz, 0.5 → 2.12 Hz, 1 → 90 Hz. */
const HZ_MIN = 0.05;
const HZ_RATIO = 1800;

export function frequencyHz(value: number): number {
	return HZ_MIN * Math.pow(HZ_RATIO, clamp01(value));
}

export function frequencyValue(hz: number): number {
	return clamp01(Math.log(hz / HZ_MIN) / Math.log(HZ_RATIO));
}

/** Live's own format: three significant figures ("0.47 Hz", "9.50 Hz", "13.8 Hz"). */
export function frequencyLabel(value: number): string {
	const hz = frequencyHz(value);
	return `${hz < 9.995 ? hz.toFixed(2) : hz.toFixed(1)} Hz`;
}

/**
 * The tile's X axis. Synced: four zones, 1/16 · 1/8 · 3/16 · 1/4. Free:
 * the bottom of the rail up to 10 Hz — about 0.707, which is where Live puts
 * 10 Hz (0.7 itself reads 9.50 Hz).
 */
export const TILE_SYNC_STEPS = [4, 6, 8, 9] as const;
export const TILE_FREQ_MAX = frequencyValue(10);

export function tileSyncStep(x: number): number {
	const zone = Math.min(TILE_SYNC_STEPS.length - 1, Math.floor(clamp01(x) * TILE_SYNC_STEPS.length));
	return TILE_SYNC_STEPS[zone];
}

/** Where a sync rate sits on the tile: the centre of its zone, or of the nearest one. */
export function tileXForSyncRate(rate: number): number {
	let best = 0;
	TILE_SYNC_STEPS.forEach((step, i) => {
		if (Math.abs(step - rate) < Math.abs(TILE_SYNC_STEPS[best] - rate)) best = i;
	});
	return (best + 0.5) / TILE_SYNC_STEPS.length;
}

export function tileFrequency(x: number): number {
	return clamp01(x) * TILE_FREQ_MAX;
}

export function tileXForFrequency(value: number): number {
	return clamp01(value / TILE_FREQ_MAX);
}

/**
 * The tile's Y axis is amount folded about the middle: full at both
 * edges, nothing at 0.5, and the lower half inverted.
 */
export function tileAmount(y: number): { amount: number; invert: 0 | 1 } {
	const t = clamp01(y);
	return { amount: Math.abs(2 * t - 1), invert: t < 0.5 ? 1 : 0 };
}

export function tileYFor(amount: number, inverted: boolean): number {
	const half = clamp01(amount) / 2;
	return inverted ? 0.5 - half : 0.5 + half;
}

/**
 * The view's shape chooser, top to bottom. Each one writes Waveform,
 * Shape and Phase together (the user's table, 2026-10-01): a square is
 * Live's SawDown with Shape at full.
 */
export const SHAPES = [
	{ key: 'saw', label: 'Saw down', waveform: 2, shape: 0 },
	{ key: 'square', label: 'Square', waveform: 2, shape: 1 },
	{ key: 'sine', label: 'Sine', waveform: 0, shape: 0 },
	{ key: 'triangle', label: 'Triangle', waveform: 1, shape: 0 }
] as const;

export type ShapeKey = (typeof SHAPES)[number]['key'];

export function shapeWrites(key: ShapeKey): ParamWrite[] {
	const s = SHAPES.find((x) => x.key === key)!;
	return [
		[AUTO_PAN.waveform, s.waveform],
		[AUTO_PAN.shape, s.shape],
		[AUTO_PAN.phase, 0]
	];
}

/** Which chooser step the device is on, or null (S&H, or a Shape set in Live). */
export function shapeIndex(waveform: number, shape: number): number | null {
	const wf = Math.round(waveform);
	if (wf === 2) return shape >= 0.5 ? 1 : 0;
	if (wf === 0) return 2;
	if (wf === 1) return 3;
	return null;
}
