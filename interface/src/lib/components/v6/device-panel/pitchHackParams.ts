/**
 * Pitch Hack (Creative Extensions, Max), measured off the running Live with
 * `owner/probes/device_dump.js` on 2026-10-15:
 *   1 Cents     -99..99
 *   2 Dry / Wet   0..100 %
 *   3 Coarse    -36..36 st
 *   4 Level     -96..0 dB
 *   5 Rate        0..23, an index into its value_items:
 *                 7 = 1/16, 10 = 1/8, 13 = 1/4, 16 = 1/2, 19 = 1/1
 *   6 Recycle     0..95 %
 *   7 Reverse     0..100 %
 *   8 Int Var     0..24 st
 *
 * `rest` is what a ghost shows: the device's own off position for each.
 */
export const PITCH_HACK = {
	cents: { index: 1, min: -99, max: 99, rest: 0 },
	mix: { index: 2, min: 0, max: 100, rest: 0 },
	coarse: { index: 3, min: -36, max: 36, rest: 0 },
	level: { index: 4, min: -96, max: 0, rest: 0 },
	rate: { index: 5 },
	recycle: { index: 6, min: 0, max: 95, rest: 0 },
	reverse: { index: 7, min: 0, max: 100, rest: 0 },
	intVar: { index: 8, min: 0, max: 24, rest: 0 }
} as const;

/** The Rate column's stops, slow to fast, top to bottom. */
export const PITCH_HACK_RATES = [
	{ label: '1', value: 19 },
	{ label: '1/2', value: 16 },
	{ label: '1/4', value: 13 },
	{ label: '1/8', value: 10 },
	{ label: '1/16', value: 7 }
] as const;
