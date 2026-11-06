/**
 * Live 12's Auto Pan-Tremolo (class AutoPan2), measured off the running
 * device (device_dump, 2026-11-06), not the Legacy Auto Pan the Tremolo
 * slot drives (`autoPanParams.ts`). The rate is whichever of four
 * parameters LFO Mode picks, so the tile and the view read and write
 * through `rateOf` / `rateWrite`.
 */

/** LOM indices. */
export const AUTO_PAN2 = {
	mode: 1, // 0 Panning, 1 Tremolo
	amount: 2, // 0..1
	wave: 3, // 0..8
	invert: 4, // switch
	lfoMode: 5, // 0 Rate, 1 Time, 2 Synced, 3 Triplet, 4 Dotted, 5 16th
	freq: 6, // 0..1, 0.1 Hz · 600^v
	time: 7, // 0..1, 100 ms .. 200 s (Live's rail)
	synced: 8, // 0..21, 8 bars .. 1/64
	sixteenth: 9, // 1..64 sixteenths
	phase: 10, // 0..1, 0..360°
	offset: 11,
	stereoMode: 12, // 0 Phase, 1 Spin
	spin: 13,
	lfoMorph: 14, // Panning's wave morph, 0..100 %
	tremoloMorph: 15, // Tremolo's, -100..100 % (0.5 = 0 %)
	attack: 16,
	dynMod: 17, // -100..100 % (0.5 = 0 %)
	harmonic: 18,
	vintage: 19
} as const;

export const MODES = ['Panning', 'Tremolo'] as const;
/** LFO Mode's six steps, Live's labels. */
export const LFO_MODES = ['Rate', 'Time', 'Synced', 'Triplet', 'Dotted', '16th'] as const;
/** LFO Wave's nine steps, Live's labels. */
export const WAVES = ['Sine', 'Triangle', 'Shark Tooth', 'Saw Up', 'Saw Down', 'Square', 'Random', 'Wander', 'S & H'] as const;

export const SYNCED_MAX = 21;
export const SIXTEENTH_MIN = 1;
export const SIXTEENTH_MAX = 64;

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** LFO Freq in Hz → its 0..1 (Live's labels: 0.10 Hz at 0, 1.00 Hz at 0.36, 60.0 Hz at 1). */
export const freqValue = (hz: number) => clamp01(Math.log(hz / 0.1) / Math.log(600));

/** The parameter LFO Mode drives the rate through. */
export function rateParam(lfoMode: number): number {
	const m = Math.round(lfoMode);
	if (m === 0) return AUTO_PAN2.freq;
	if (m === 1) return AUTO_PAN2.time;
	if (m === 5) return AUTO_PAN2.sixteenth;
	return AUTO_PAN2.synced;
}

/**
 * The rate as 0..1, slow at the left: Synced runs 8 bars → 1/64 and 16th
 * runs 64 → 1 sixteenths, so the 16th rail is turned over; a longer Time
 * is slower too.
 */
export function rateOf(lfoMode: number, value: number): number {
	const p = rateParam(lfoMode);
	if (p === AUTO_PAN2.freq) return clamp01(value);
	if (p === AUTO_PAN2.time) return 1 - clamp01(value);
	if (p === AUTO_PAN2.sixteenth) return clamp01((SIXTEENTH_MAX - value) / (SIXTEENTH_MAX - SIXTEENTH_MIN));
	return clamp01(value / SYNCED_MAX);
}

/** The write that puts the rate at `t` (0..1, slow at the left) in LFO Mode's units. */
export function rateWrite(lfoMode: number, t: number): readonly [number, number] {
	const p = rateParam(lfoMode);
	const u = clamp01(t);
	if (p === AUTO_PAN2.freq) return [p, u];
	if (p === AUTO_PAN2.time) return [p, 1 - u];
	if (p === AUTO_PAN2.sixteenth) return [p, Math.round(SIXTEENTH_MAX - u * (SIXTEENTH_MAX - SIXTEENTH_MIN))];
	return [p, Math.round(u * SYNCED_MAX)];
}

/** The Tremolo picture's shape for a wave: 0 saw down, 1 square, 2 sine, 3 triangle (`devicePictures`). */
export function pictureShape(wave: number): number {
	switch (Math.round(wave)) {
		case 1:
		case 2:
			return 3;
		case 3:
		case 4:
			return 0;
		case 5:
			return 1;
		default:
			return 2;
	}
}
