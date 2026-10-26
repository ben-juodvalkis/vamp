/**
 * Live's own curves for the parameters a preset saves in display units but the
 * LOM reports on a 0..1 (or -1..1) rail — sampled off the running Live with
 * `str_for_value` at 65 evenly spaced points (2026-10-25, Live 12.4.15b7, one
 * preset of each device loaded onto a track and removed). Generated from the
 * samples; do not edit by hand.
 *
 * A table lists the unit value at each of 65 rail points from `min` to `max`.
 * `railFor` inverts one: the rail value whose label is `unit`, interpolated
 * between the two samples around it (in log space where the unit is positive,
 * since these are all exponential sweeps). Labels carry three significant
 * figures, so a round trip lands within a sample's rounding.
 */

export interface RailTable {
	min: number;
	max: number;
	/** The unit value at each of the evenly spaced rail points. */
	units: readonly number[];
	/** Interpolate in log space (every sample > 0). */
	log: boolean;
}

/** Echo's L Time (parameter 2): seconds, 1.00 ms at 0, 250 ms at 0.5, 2.50 s at 1. */
export const ECHO_TIME_SECONDS: RailTable = { min: 0, max: 1, log: true, units: [0.001, 0.001, 0.00102, 0.00109, 0.00124, 0.00151, 0.00194, 0.00258, 0.00346, 0.00464, 0.00617, 0.0081, 0.0105, 0.0134, 0.0168, 0.0209, 0.0257, 0.0312, 0.0376, 0.0448, 0.053, 0.0621, 0.0724, 0.0837, 0.0963, 0.11, 0.125, 0.142, 0.16, 0.18, 0.201, 0.225, 0.25, 0.276, 0.305, 0.336, 0.369, 0.404, 0.441, 0.481, 0.523, 0.568, 0.616, 0.666, 0.719, 0.774, 0.833, 0.895, 0.96, 1.03, 1.1, 1.17, 1.25, 1.33, 1.42, 1.51, 1.6, 1.7, 1.8, 1.91, 2.02, 2.13, 2.25, 2.37, 2.5] };

/** Chorus-Ensemble's Rate (parameter 3): Hz, 0.10 Hz at 0, 1.58 Hz at 0.5, 15.0 Hz at 1. */
export const CHORUS_RATE_HZ: RailTable = { min: 0, max: 1, log: true, units: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.11, 0.11, 0.11, 0.12, 0.13, 0.14, 0.16, 0.17, 0.19, 0.22, 0.25, 0.28, 0.32, 0.36, 0.41, 0.46, 0.53, 0.59, 0.67, 0.75, 0.84, 0.94, 1.05, 1.17, 1.3, 1.43, 1.58, 1.74, 1.91, 2.1, 2.29, 2.5, 2.73, 2.96, 3.22, 3.48, 3.76, 4.06, 4.38, 4.71, 5.06, 5.43, 5.82, 6.22, 6.65, 7.1, 7.56, 8.05, 8.56, 9.1, 9.65, 10.2, 10.8, 11.5, 12.1, 12.8, 13.5, 14.2, 15.0] };

/** Utility's Output (parameter 9, -1..1): dB, -inf at -1, 0 dB at 0, 35.0 dB at 1. */
export const UTILITY_OUTPUT_DB: RailTable = { min: -1, max: 1, log: false, units: [-Infinity, -66.0, -53.9, -46.8, -41.8, -37.9, -34.7, -32.0, -29.6, -27.6, -25.7, -24.1, -22.5, -21.1, -19.8, -18.6, -17.5, -16.4, -15.3, -14.2, -13.1, -12.0, -10.9, -9.84, -8.75, -7.66, -6.56, -5.47, -4.38, -3.28, -2.19, -1.09, 0.0, 1.09, 2.19, 3.28, 4.38, 5.47, 6.56, 7.66, 8.75, 9.84, 10.9, 12.0, 13.1, 14.2, 15.3, 16.4, 17.5, 18.6, 19.7, 20.8, 21.9, 23.0, 24.1, 25.2, 26.2, 27.3, 28.4, 29.5, 30.6, 31.7, 32.8, 33.9, 35.0] };

/** The rail value whose label is `unit`, clamped to the rail. */
export function railFor(table: RailTable, unit: number): number {
	const { units, min, max } = table;
	const n = units.length - 1;
	const at = (i: number) => min + ((max - min) * i) / n;
	const f = (u: number) => (table.log ? Math.log(u) : u);
	if (!(unit > units[0]) || (table.log && unit <= 0)) return min;
	if (unit >= units[n]) return max;
	for (let i = 1; i <= n; i++) {
		if (units[i] >= unit) {
			const lo = units[i - 1];
			const hi = units[i];
			if (hi === lo || !Number.isFinite(lo)) return at(i);
			const t = (f(unit) - f(lo)) / (f(hi) - f(lo));
			return at(i - 1) + t * (at(i) - at(i - 1));
		}
	}
	return max;
}

/** Gate's and Compressor's Threshold (parameter 1; the two agree at every quarter Live labels): dB, -inf at 0, -14.0 dB at 0.5, 6.00 dB at 1. */
export const THRESHOLD_DB: RailTable = { min: 0, max: 1, log: false, units: [-Infinity, -64.6, -60.7, -57.7, -54.9, -52.2, -49.6, -47.1, -44.6, -42.3, -40.1, -38, -35.9, -34, -32.2, -30.4, -28.8, -27.2, -25.8, -24.5, -23.2, -22.1, -21, -20, -19.2, -18.4, -17.7, -17.1, -16.5, -15.9, -15.2, -14.6, -14, -13.4, -12.7, -12.1, -11.5, -10.9, -10.2, -9.62, -9, -8.37, -7.75, -7.12, -6.5, -5.87, -5.25, -4.62, -4, -3.37, -2.75, -2.12, -1.5, -0.87, -0.25, 0.38, 1, 1.63, 2.25, 2.88, 3.5, 4.13, 4.75, 5.38, 6] };

/** Redux's Sample Rate (parameter 1): Hz, 20.0 Hz at 0, 3.99 kHz at 0.5, 40.0 kHz at 1. */
export const REDUX_SAMPLE_RATE_HZ: RailTable = { min: 0, max: 1, log: true, units: [20, 20, 20.4, 21.5, 23.9, 28.2, 35, 45, 59, 77.8, 102, 133, 171, 217, 272, 337, 414, 502, 603, 718, 848, 994, 1160, 1340, 1540, 1760, 2010, 2270, 2560, 2880, 3220, 3590, 3990, 4420, 4870, 5370, 5890, 6460, 7050, 7690, 8370, 9080, 9840, 10600, 11500, 12400, 13300, 14300, 15300, 16400, 17600, 18800, 20000, 21300, 22700, 24100, 25600, 27200, 28800, 30500, 32300, 34100, 36000, 38000, 40000] };
