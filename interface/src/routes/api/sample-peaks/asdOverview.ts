/**
 * Path C for `/api/sample-peaks`: read the waveform overview Live
 * already computed and stored in the `.asd` analysis sidecar, so we can
 * render a waveform for samples the streaming/decode paths can't read.
 *
 * The motivating case is Ableton's protected pack content — AIFC files
 * carrying a proprietary `able` compression tag ("Ableton Content").
 * Path A's PCM probe rejects them (not uniform PCM), and Path B's
 * `audio-decode` / CoreAudio / ffmpeg all refuse the codec, so those
 * clips otherwise get a blank canvas (a silent 415). But every warped
 * sample ships a `<sample>.asd` next to it, and that file contains
 * Live's own min/max overview envelope — no audio decode required.
 *
 * ## Format (reverse-engineered, verified against Live 10 + 12 `.asd`)
 *
 * The body is a typed serialization with UTF-16LE length-prefixed field
 * names. The overview is a `List<SampleOverViewLevel>` of multi-zoom
 * levels. Each data-bearing level is anchored by the ASCII marker
 * `SampleOverViewLevel`, immediately followed by:
 *
 *   uint32 LE  levelIndex   (0 = highest resolution)
 *   uint32 LE  count        (= 2 * bins; number of float16 values)
 *   float16[count] LE       interleaved: min0, max0, min1, max1, ...
 *                           normalized to [-1, 1]
 *
 * The marker string ALSO appears in the schema/type header (~6x total
 * per file); only 1-3 occurrences are real data levels. We distinguish
 * them structurally: a real level has count > 0, count even, the block
 * fits in the file, and the decoded values sit within a small tolerance
 * of [-1, 1]. Schema-header occurrences fail those guards.
 *
 * We locate blocks by scanning for the marker (NOT a fixed offset — the
 * absolute position shifts between Live versions), pick the level with
 * the most bins, and resample it to the caller's requested bin count.
 *
 * Half-precision decode is done by hand: Node's Buffer has no float16
 * reader, and DataView.getFloat16 is not yet baseline in the SvelteKit
 * server runtime we target. The conversion below is exact for all
 * finite/denormal/inf/nan half values.
 */
import { open } from 'node:fs/promises';

const MARKER = Buffer.from('SampleOverViewLevel', 'ascii');

// Values are normalized amplitudes; allow a hair past [-1, 1] for
// float16 rounding before rejecting a candidate as non-audio.
const VALUE_TOLERANCE = 1.06;

// A single overview level is small (a few thousand float16s). This caps
// how much of the `.asd` we'll treat as one block, guarding against a
// bogus count word steering us into a huge allocation.
const MAX_LEVEL_VALUES = 1 << 20; // 1,048,576 values = 512K bins

export type AsdOverview = {
	/** min/max pairs, one per bin, each in [-1, 1]. */
	peaks: [number, number][];
	/** Bin count of the source level (before resampling). */
	sourceBins: number;
};

/**
 * Convert an IEEE-754 binary16 (half) bit pattern to a JS number.
 * Handles zero, subnormals, normals, Inf, and NaN.
 */
function halfToFloat(h: number): number {
	const sign = (h & 0x8000) >> 15;
	const exp = (h & 0x7c00) >> 10;
	const frac = h & 0x03ff;
	let val: number;
	if (exp === 0) {
		// Subnormal (or zero): no implicit leading 1.
		val = frac * 2 ** -24;
	} else if (exp === 0x1f) {
		// Inf / NaN.
		val = frac === 0 ? Infinity : NaN;
	} else {
		// Normal: (1 + frac/1024) * 2^(exp-15).
		val = (1 + frac / 1024) * 2 ** (exp - 15);
	}
	return sign ? -val : val;
}

/**
 * Parse every plausible overview level out of an `.asd` buffer and
 * return the one with the most bins (highest resolution), or null if
 * none qualifies.
 */
function extractBestLevel(data: Buffer): { peaks: [number, number][]; bins: number } | null {
	let best: { peaks: [number, number][]; bins: number } | null = null;

	let searchFrom = 0;
	for (;;) {
		const mi = data.indexOf(MARKER, searchFrom);
		if (mi < 0) break;
		searchFrom = mi + MARKER.length;

		const p = mi + MARKER.length;
		// Need 8 bytes for levelIndex + count.
		if (p + 8 > data.length) continue;
		// levelIndex (p..p+4) is unused for selection — read count only.
		const count = data.readUInt32LE(p + 4);
		if (count === 0 || count % 2 !== 0 || count > MAX_LEVEL_VALUES) continue;

		const blob = p + 8;
		const end = blob + count * 2; // 2 bytes per float16
		if (end > data.length) continue;

		// Decode and validate: real overview values live in [-1, 1]. A
		// spurious marker hit (schema header) yields out-of-range junk.
		const nPairs = count / 2;
		const peaks: [number, number][] = new Array(nPairs);
		let valid = true;
		for (let i = 0; i < nPairs; i++) {
			const lo = halfToFloat(data.readUInt16LE(blob + i * 4));
			const hi = halfToFloat(data.readUInt16LE(blob + i * 4 + 2));
			if (
				!Number.isFinite(lo) ||
				!Number.isFinite(hi) ||
				lo < -VALUE_TOLERANCE ||
				lo > VALUE_TOLERANCE ||
				hi < -VALUE_TOLERANCE ||
				hi > VALUE_TOLERANCE ||
				lo > hi
			) {
				valid = false;
				break;
			}
			peaks[i] = [lo, hi];
		}
		if (!valid) continue;

		if (!best || nPairs > best.bins) {
			best = { peaks, bins: nPairs };
		}
	}

	return best;
}

/**
 * Resample a min/max envelope to `targetBins` by taking, for each
 * output bin, the min-of-mins and max-of-maxes over the source pairs it
 * covers. Downsampling (source > target) is the normal case; upsampling
 * repeats source pairs, which never happens in practice (overview
 * levels have thousands of bins vs. the 256-bin strip).
 */
function resamplePeaks(
	src: [number, number][],
	targetBins: number
): [number, number][] {
	const srcN = src.length;
	if (targetBins >= srcN) {
		// Nearest-source upsample; keeps the API total honest without
		// inventing detail.
		const out: [number, number][] = new Array(targetBins);
		for (let i = 0; i < targetBins; i++) {
			const s = Math.min(srcN - 1, Math.floor((i * srcN) / targetBins));
			out[i] = src[s];
		}
		return out;
	}
	const out: [number, number][] = new Array(targetBins);
	const per = srcN / targetBins;
	for (let i = 0; i < targetBins; i++) {
		const start = Math.floor(i * per);
		const stop = Math.min(srcN, Math.floor((i + 1) * per));
		let lo = Infinity;
		let hi = -Infinity;
		for (let s = start; s < stop; s++) {
			if (src[s][0] < lo) lo = src[s][0];
			if (src[s][1] > hi) hi = src[s][1];
		}
		if (lo === Infinity) {
			lo = 0;
			hi = 0;
		}
		out[i] = [lo, hi];
	}
	return out;
}

/**
 * Parse an already-loaded `.asd` buffer to a resampled overview.
 * Exposed for unit tests; the route uses {@link readAsdOverview}.
 */
export function parseAsdOverview(data: Buffer, bins: number): AsdOverview | null {
	const level = extractBestLevel(data);
	if (!level) return null;
	const safeBins = Math.max(1, Math.floor(Number(bins) || 1));
	return {
		peaks: resamplePeaks(level.peaks, safeBins),
		sourceBins: level.bins
	};
}

/**
 * Read `<samplePath>.asd` (if it exists) and return its overview
 * resampled to `bins`. Returns null when the sidecar is absent,
 * unreadable, or contains no valid overview level — the route then
 * falls through to Path B.
 */
export async function readAsdOverview(
	samplePath: string,
	bins: number
): Promise<AsdOverview | null> {
	const asdPath = `${samplePath}.asd`;
	let fh: Awaited<ReturnType<typeof open>> | null = null;
	try {
		fh = await open(asdPath, 'r');
		const data = await fh.readFile();
		return parseAsdOverview(data, bins);
	} catch {
		// ENOENT (no sidecar) is the common, expected case — degrade
		// quietly and let the caller continue to Path B.
		return null;
	} finally {
		if (fh) await fh.close().catch(() => {});
	}
}
