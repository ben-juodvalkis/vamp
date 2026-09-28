/**
 * First-transient detector for the auto-trim flow.
 *
 * Runs on already-decoded `channelData` (Float32Array per channel)
 * and returns the frame index of the first transient, with a small
 * lookback so the marker lands just before the attack rather than
 * at its peak. Returns 0 when no transient is detectable (silent,
 * too short, or noise-dominated samples).
 *
 * Lives in its own module rather than inline in `decodeWorker.js`
 * so the algorithm can be unit-tested with synthetic buffers without
 * spinning up a worker thread.
 *
 * Algorithm:
 *
 * - Build a mono envelope (mean of |channels| per frame).
 * - Smooth via an 8ms RMS sliding window — short enough to keep
 *   percussive attacks sharp, long enough to suppress single-sample
 *   noise spikes.
 * - Estimate noise floor from the 10th-percentile of the smoothed
 *   envelope (sampled at 4096 strided indices for cheap sort).
 * - Threshold = max(noiseFloor * 6.0, peak * 0.02). The peak-relative
 *   floor (2% of the sample's own smoothed peak, ≈ -34 dB below it)
 *   makes detection scale-invariant: a quiet capture and a loud one
 *   trigger at the same point in the attack, so the detector agrees
 *   with the gain Simpler will actually play the sample at (peak
 *   normalization is applied separately, on sample.gain, and never
 *   touches the file this reads). The ratio term still handles loud,
 *   ambient samples where the relative floor alone would pick the
 *   first noise burst.
 * - The first hit is the first sound within 12 dB of the peak
 *   (peak * 0.25). Soft sounds ahead of it — room noise, handling,
 *   bleed, 20+ dB under the take — are skipped: measured on a
 *   2026-09-27 capture, a -22 dB bump at 30 ms took the marker while
 *   the playing started at 680 ms. The attack is then walked back to
 *   where that hit first rose above the quiet threshold, so a hit
 *   that swells in keeps its front (a 2026-09-03 capture: 1201 ms
 *   either way, where a -12 dB crossing alone gave 1248 ms).
 * - Subtract a 5ms lookback so the marker lands just before the
 *   transient rather than at its peak.
 *
 * @param {Float32Array[]} channelData
 * @param {number} sampleRate
 * @returns {number}
 */
export function findFirstTransient(channelData, sampleRate) {
	const channels = channelData.length;
	const frames = channels > 0 ? channelData[0].length : 0;
	if (frames === 0 || sampleRate <= 0) return 0;

	const win = Math.max(1, Math.round(0.008 * sampleRate));
	if (frames < win * 4) return 0;

	// Mono envelope: |mean(channels)| per frame. One pass.
	const mono = new Float32Array(frames);
	for (let f = 0; f < frames; f++) {
		let sum = 0;
		for (let c = 0; c < channels; c++) sum += channelData[c][f];
		const v = sum / channels;
		mono[f] = v < 0 ? -v : v;
	}

	// Sliding-window RMS via running sum-of-squares. Output indexed by
	// the window's right edge so smoothed[f] corresponds to the energy
	// in [f - win + 1 .. f].
	const smoothed = new Float32Array(frames);
	let acc = 0;
	for (let f = 0; f < frames; f++) {
		const v = mono[f];
		acc += v * v;
		if (f >= win) {
			const old = mono[f - win];
			acc -= old * old;
		}
		const denom = f < win ? f + 1 : win;
		smoothed[f] = Math.sqrt(acc / denom);
	}

	// Noise floor: sample 4096 strided values, sort, take 10th percentile.
	const SAMPLES = 4096;
	const stride = Math.max(1, Math.floor(frames / SAMPLES));
	const sampled = [];
	for (let f = 0; f < frames; f += stride) sampled.push(smoothed[f]);
	sampled.sort((a, b) => a - b);
	const noiseFloor = sampled[Math.floor(sampled.length * 0.1)] || 0;
	if (noiseFloor >= 0.3) return 0;

	// Peak of the smoothed envelope. Used to make the absolute floor
	// relative to the sample's own level so a quiet capture trips at the
	// same point in the attack as a loud one (scale-invariance).
	let peak = 0;
	for (let f = 0; f < frames; f++) {
		if (smoothed[f] > peak) peak = smoothed[f];
	}
	if (peak <= 0) return 0;

	const thresh = Math.max(noiseFloor * 6.0, peak * 0.02);
	const hitThresh = Math.max(thresh, peak * 0.25);
	let attack = -1;
	for (let f = 0; f < frames; f++) {
		if (smoothed[f] > hitThresh) {
			attack = f;
			break;
		}
	}
	if (attack < 0) return 0;
	// Back to where that hit rose out of the quiet, so the attack stays whole.
	while (attack > 0 && smoothed[attack - 1] > thresh) attack--;

	const lookback = Math.round(0.005 * sampleRate);
	return Math.max(0, attack - lookback);
}
