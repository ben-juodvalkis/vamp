/**
 * Auto Filter (`AutoFilter2`), as the running Live reports it — dumped on
 * the rig 2026-10-25 (Live 12.4.15b7, the Disco Filter preset,
 * `node owner/probes/device_dump.js`). Shared by the grid tile, the central
 * view, the chain overview and the browser's preset tiles.
 *
 * Frequency is 0..1 on the LOM and Hz in a preset: Live's labels
 * (0 → 20.0 Hz, 0.25 → 112 Hz, 0.5 → 632 Hz, 0.75 → 3.56 kHz, 1 → 20.0 kHz)
 * are `20 · 1000^v`, and Disco Filter's saved 169.668594 Hz is the LOM's
 * 0.3095238 to seven digits. Resonance and Filter Type are the same number
 * in both.
 */
import type { CurveType } from './FilterCurve.svelte';

/** LOM parameter indices (Live's names). */
export const AUTO_FILTER_PARAM = {
	frequency: 1, // Frequency, 0..1
	resonance: 2, // Resonance, 0..1
	type: 4 // Filter Type, 0..9, quantized
} as const;

/** The names an `.adv` saves those three under. */
export const AUTO_FILTER_PRESET_NAMES = {
	frequency: 'Filter_Frequency', // Hz
	resonance: 'Filter_Resonance',
	type: 'Filter_Type'
} as const;

/** Live's own Filter Type labels, by value (`str_for_value`). */
export const AUTO_FILTER_TYPE_LABELS = [
	'Low-pass',
	'High-pass',
	'Band-pass',
	'Notch',
	'Morph',
	'DJ',
	'Comb',
	'Resampling',
	'Notch+LP',
	'Vowel'
] as const;

/** The curve each type is drawn as: the nearest shape FilterCurve has. */
export const AUTO_FILTER_TYPE_CURVES: readonly CurveType[] = [
	'lowpass', // Low-pass
	'highpass', // High-pass
	'bandpass', // Band-pass
	'notch', // Notch
	'lowpass', // Morph (from low-pass)
	'lowpass', // DJ (a low-pass one way, high-pass the other)
	'peak', // Comb
	'lowpass', // Resampling
	'notch', // Notch+LP
	'bandpass' // Vowel (formant peaks)
];

export function autoFilterCurve(type: number): CurveType {
	return AUTO_FILTER_TYPE_CURVES[Math.round(type)] ?? 'lowpass';
}

/** A frequency in Hz as the LOM's 0..1 (`20 · 1000^v`), clamped. */
export function frequencyToValue(hz: number): number {
	if (!(hz > 0)) return 0;
	return Math.min(1, Math.max(0, Math.log(hz / 20) / Math.log(1000)));
}

/** The LOM's 0..1 as Hz. */
export function valueToFrequency(v: number): number {
	return 20 * Math.pow(1000, v);
}

export interface AutoFilterValues {
	frequency: number;
	resonance: number;
	type: number;
}

/** A preset's saved values as LOM values, or null when it saves no frequency. */
export function autoFilterFromPreset(params: Record<string, number>): AutoFilterValues | null {
	const hz = params[AUTO_FILTER_PRESET_NAMES.frequency];
	if (hz === undefined) return null;
	return {
		frequency: frequencyToValue(hz),
		resonance: params[AUTO_FILTER_PRESET_NAMES.resonance] ?? 0,
		type: params[AUTO_FILTER_PRESET_NAMES.type] ?? 0
	};
}
