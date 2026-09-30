/**
 * Every onset in a sample, for when Live's own (the `.asd` onsets,
 * asdOnsets.ts) are missing — a fresh recording Live has not analysed,
 * a file with no sidecar.
 *
 * Runs on a peak envelope at a fine hop (the route asks for one bin per
 * `HOP_FRAMES`, ~6 ms at 44.1 kHz) rather than on raw samples, so the
 * same code serves the streaming path and the decode path. An onset is a
 * hop whose level jumps well above the loudest of the few hops before
 * it, loud enough to count against the file's own peak, and the biggest
 * such jump within `MIN_GAP_S`. It is placed one hop early so a marker
 * lands on the front of the attack, as Live's do.
 *
 * @param {[number, number][]} peaks  min/max per hop
 * @param {number} hopSeconds
 * @returns {number[]} onset times, seconds, increasing
 */
export const HOP_FRAMES = 256;
const LOOKBACK = 4; // hops the rise is measured against
const RISE = 1.8; // ~5 dB over the recent loudest
const FLOOR_OF_PEAK = 0.06; // quieter than ~-24 dB under the peak is not a hit
const MIN_GAP_S = 0.06;

export function detectOnsets(peaks, hopSeconds) {
	const n = peaks.length;
	if (n < LOOKBACK + 2 || !(hopSeconds > 0)) return [];
	const env = new Float32Array(n);
	let peak = 0;
	for (let i = 0; i < n; i++) {
		const [lo, hi] = peaks[i];
		const a = Math.max(Math.abs(lo), Math.abs(hi));
		env[i] = a;
		if (a > peak) peak = a;
	}
	if (peak <= 0) return [];
	const floor = peak * FLOOR_OF_PEAK;
	const rise = new Float32Array(n);
	for (let i = LOOKBACK; i < n; i++) {
		let before = 0;
		for (let k = i - LOOKBACK; k < i; k++) if (env[k] > before) before = env[k];
		rise[i] = env[i] > floor ? env[i] / (before + peak * 1e-3) : 0;
	}
	const gap = Math.max(1, Math.round(MIN_GAP_S / hopSeconds));
	const out = [];
	let last = -Infinity;
	for (let i = LOOKBACK; i < n; i++) {
		if (rise[i] < RISE) continue;
		let best = true;
		for (let k = Math.max(0, i - gap); k <= Math.min(n - 1, i + gap) && best; k++) {
			if (rise[k] > rise[i] || (rise[k] === rise[i] && k < i)) best = false;
		}
		if (!best || i - last < gap) continue;
		last = i;
		out.push(Math.max(0, i - 1) * hopSeconds);
	}
	return out;
}
