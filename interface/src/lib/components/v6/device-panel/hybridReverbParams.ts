/**
 * Hybrid Reverb's stepped parameters (LOM class `Hybrid`).
 *
 * Read off the running device on 2026-10-02 (Live 12 Beta, `str_for_value`
 * per step). Every other parameter the reverb views drive is 0..1; these
 * are not, and a 0..1 slider written to them as is reaches only the bottom
 * two steps.
 *
 *  21 Ti Rate   0..29   TIDES_RATE_LABELS (default 22 = "1")
 *
 * Values are raw Live units.
 */

export const TIDES_RATE = 21;

/** Ti Rate's 30 steps as Live labels them, by value. */
export const TIDES_RATE_LABELS = [
	'1/128 T', '1/128', '1/64 T', '1/128 D', '1/64', '1/32 T', '1/64 D', '1/32',
	'1/16 T', '1/32 D', '1/16', '1/8 T', '1/16 D', '1/8', '1/4 T', '1/8 D', '1/4',
	'1/2 T', '1/4 D', '1/2', '1 T', '1/2 D', '1', '2 T', '1 D', '2', '4 T', '2 D',
	'4', '4 D'
] as const;
export const TIDES_RATE_MAX = TIDES_RATE_LABELS.length - 1;
export const TIDES_RATE_DEFAULT = 22;

/** The raw range of each Hybrid parameter that is not 0..1, by index. */
export const STEPPED_MAX: Readonly<Record<number, number>> = { [TIDES_RATE]: TIDES_RATE_MAX };

/**
 * Live's default for each parameter the views show where it is not 0.5:
 * what a slider draws before the device's values arrive. The IR properties
 * clamp, measured by write-and-restore: attack 0..3 s, decay 0.02..20 s,
 * size 0.2..5.
 */
export const LIVE_DEFAULTS: Readonly<Record<number, number>> = {
	13: 1, // Diffusion
	19: 1, // Sh Pitch Shift (+12 st)
	[TIDES_RATE]: TIDES_RATE_DEFAULT,
	26: 0.5885919332504272, // Pr High Mult (100 %)
	27: 0.5885919332504272 // Pr Low Mult (100 %)
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A 0..1 slider position to the raw value Live takes for this parameter. */
export function toRaw(index: number, position: number): number {
	const max = STEPPED_MAX[index];
	return max === undefined ? clamp01(position) : Math.round(clamp01(position) * max);
}

/** A raw Live value to the 0..1 slider position. */
export function toPosition(index: number, raw: number): number {
	const max = STEPPED_MAX[index];
	return max === undefined ? clamp01(raw) : clamp01(raw / max);
}

export function tidesRateLabel(value: number): string {
	return TIDES_RATE_LABELS[Math.max(0, Math.min(TIDES_RATE_MAX, Math.round(value)))];
}
