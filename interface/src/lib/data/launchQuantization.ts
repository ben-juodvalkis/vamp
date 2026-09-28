/**
 * Global Launch Quantization Data
 *
 * Maps Live's `song.clip_trigger_quantization` enum (0-13) to display
 * names. This is the grid clip launch — and therefore loop record
 * start/stop — snaps to. Same shape as `scales.ts`: index-addressed
 * labels for a LOM enum, shared by the session store's range guard and
 * the picker UI so the two can't drift.
 *
 * Order is Live's own, coarse → fine. See
 * `docs/reference/live-api-measurements.md` "Quantization values".
 */

export const LAUNCH_QUANTIZATIONS = [
	'None',
	'8 Bar',
	'4 Bar',
	'2 Bar',
	'1 Bar',
	'1/2',
	'1/2T',
	'1/4',
	'1/4T',
	'1/8',
	'1/8T',
	'1/16',
	'1/16T',
	'1/32'
] as const;

/** Live's own default — one bar. */
export const DEFAULT_LAUNCH_QUANTIZATION = 4;

export function isValidLaunchQuantization(value: number): boolean {
	return Number.isInteger(value) && value >= 0 && value < LAUNCH_QUANTIZATIONS.length;
}

/** Display label, or `'—'` for a value Live doesn't define. */
export function getLaunchQuantizationName(index: number): string {
	return isValidLaunchQuantization(index) ? LAUNCH_QUANTIZATIONS[index] : '—';
}
