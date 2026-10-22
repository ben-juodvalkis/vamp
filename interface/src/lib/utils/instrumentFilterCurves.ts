/**
 * What each instrument's filter looks like on the FX grid's filter curve
 * (`FilterCurve`, drawn by `DeviceXY` under `showCurve`): which response,
 * how many stages, and the Hz span its cutoff sweeps.
 *
 * Measured off the running Live 12.4.15 on 2026-10-22, every device fresh
 * from `insert_device`, with `str_for_value` across each parameter's range.
 * Every cutoff is a pure log sweep between the ends below; resonance is
 * read as a fraction of its own rail (Operator, Sampler, Simpler and
 * Wavetable run to 125 %, the rest to 100 %).
 *
 * The curve is the house biquad, so a type the biquad has no shape for
 * draws the nearest one (Analog's Formant as a band-pass) or nothing at
 * all (Meld's Phaser, Comb, Vowel, resonators), never a made-up shape.
 */
import type { CurveType } from '$lib/components/v6/device-panel/FilterCurve.svelte';

export interface InstrumentCurve {
	curveType: CurveType;
	order: number;
}

/** Cutoff ends in Hz, from Live's own labels at 0 and 1. */
export const FILTER_FREQ_RANGE = {
	analog: [30, 22000], // F1/F2 Freq
	operator: [30, 18500], // Filter Freq
	sampler: [30, 22000], // Filter Freq (Sampler and Simpler alike)
	wavetable: [20, 20480], // Flt 1/2 Freq: 20 Hz doubling per tenth
	meld: [20, 20480], // A/B Filter Freq
	drift: [20, 20000] // LP Freq
} as const satisfies Record<string, readonly [number, number]>;

/** Where X lands on FilterCurve's own axis (log 20 Hz..20 kHz). */
export function hzToCurveX(hz: number): number {
	return Math.log10(hz / 20) / 3;
}

const MORPH_STOPS: CurveType[] = ['lowpass', 'bandpass', 'highpass', 'notch'];

/**
 * Operator, Sampler, Simpler and Wavetable share one filter: `Filter Type`
 * 0..4 = Lowpass, Highpass, Bandpass, Notch, Morph; `Filter Slope` 0/1 =
 * 12/24 dB. Morph 0..1 runs LP → BP → HP → Notch → LP in quarters (Live's
 * labels: "lp/bp", "bp/hp", "hp/no", "no/lp"), drawn as the nearest stop.
 */
export function liveFilterCurve(type: number, slope: number, morph = 0): InstrumentCurve {
	const t = Math.round(type);
	const order = Math.round(slope) >= 1 ? 2 : 1;
	if (t === 4) return { curveType: MORPH_STOPS[Math.round(morph * 4) % 4], order };
	return { curveType: (['lowpass', 'highpass', 'bandpass', 'notch'] as const)[t] ?? 'lowpass', order };
}

/**
 * Analog `F1/F2 Type` 0..9: LP 12/24, BP 6/12, Notch 2/4-pole, HP 12/24,
 * Formant 6/12. The biquad's band-pass skirts are 6 dB/oct, so the first of
 * each pair is one stage and the second two.
 */
export function analogFilterCurve(type: number): InstrumentCurve {
	const t = Math.round(type);
	const family = (['lowpass', 'bandpass', 'notch', 'highpass', 'bandpass'] as const)[Math.floor(t / 2)] ?? 'lowpass';
	return { curveType: family, order: (t % 2) + 1 };
}

/**
 * Meld `A/B Filter Type` 0..16. The two SVFs (12 and 24 dB) morph
 * LP → BP → HP → Notch on `Filter L-B-H-N` 0..1, drawn as the nearest stop.
 */
export function meldFilterCurve(type: number, lbhn = 0): InstrumentCurve {
	switch (Math.round(type)) {
		case 0:
			return { curveType: MORPH_STOPS[Math.round(lbhn * 3)], order: 1 }; // SVF 12dB
		case 1:
			return { curveType: MORPH_STOPS[Math.round(lbhn * 3)], order: 2 }; // SVF 24dB
		case 2: // LP 12dB MS2
		case 5: // LP Crunch 12dB
		case 6: // LP Switched Res
			return { curveType: 'lowpass', order: 1 };
		case 3:
			return { curveType: 'highpass', order: 1 }; // HP 12dB MS2
		case 4:
			return { curveType: 'bandpass', order: 1 }; // BP 12dB OSR
		case 8:
			return { curveType: 'peak', order: 1 }; // Eq Peak
		case 9:
			return { curveType: 'notch', order: 1 }; // Eq Notch
		default:
			// Filther, Phaser, Redux, Vowel, Comb ±, Plate and Membrane Resonator
			return { curveType: 'none', order: 1 };
	}
}

/**
 * Drift's low-pass, `LP Type` 0/1 = Live's "I"/"II". Live labels only the
 * numeral; Ableton's manual gives I as 12 dB/oct and II as 24 dB/oct.
 */
export function driftFilterCurve(lpType: number): InstrumentCurve {
	return { curveType: 'lowpass', order: Math.round(lpType) >= 1 ? 2 : 1 };
}
