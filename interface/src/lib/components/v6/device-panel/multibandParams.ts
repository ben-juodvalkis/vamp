/**
 * Multiband Dynamics (MultibandDynamics), the three controls the Gain view
 * draws. Indices and rails measured off the running Live with
 * `owner/probes/device_dump.js` (2026-10-09):
 *    5 = Output                 -24..24 dB
 *   21 = Below Threshold (Mid)  -80..0 dB
 *   27 = Below Ratio (Mid)      -3..1
 */
export const MB_OUTPUT = 5;
export const MB_OUTPUT_MIN = -24;
export const MB_OUTPUT_MAX = 24;

export const MB_BELOW_THRESHOLD_MID = 21;
export const MB_THRESHOLD_MIN = -80;
export const MB_THRESHOLD_MAX = 0;

export const MB_BELOW_RATIO_MID = 27;
export const MB_RATIO_MIN = -3;
export const MB_RATIO_MAX = 1;

/**
 * The ratio slider puts 0 at its middle (user, 2026-10-09): the bottom
 * half spans -3..0 and the top half 0..1, so each half is linear on its
 * own scale. `t` is the slider's 0..1 position.
 */
export function ratioFromSlider(t: number): number {
	const p = Math.min(1, Math.max(0, t));
	return p <= 0.5 ? MB_RATIO_MIN * (1 - p / 0.5) : MB_RATIO_MAX * ((p - 0.5) / 0.5);
}

export function sliderFromRatio(ratio: number): number {
	const r = Math.min(MB_RATIO_MAX, Math.max(MB_RATIO_MIN, ratio));
	return r <= 0 ? 0.5 * (1 - r / MB_RATIO_MIN) : 0.5 + 0.5 * (r / MB_RATIO_MAX);
}
