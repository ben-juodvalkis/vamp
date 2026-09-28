import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseAsdOverview } from '../../../../routes/api/sample-peaks/asdOverview';

const MARKER = 'SampleOverViewLevel';

/**
 * Build a minimal `.asd`-shaped buffer with one overview level:
 *   [MARKER][uint32 levelIndex][uint32 count][float16 pairs...]
 * `pairs` are [min, max] tuples encoded as LE float16.
 */
function buildAsd(
	levels: { levelIndex: number; pairs: [number, number][] }[],
	opts: { prefix?: Buffer; suffix?: Buffer; junkMarkers?: Buffer[] } = {}
): Buffer {
	const parts: Buffer[] = [];
	if (opts.prefix) parts.push(opts.prefix);
	for (const jm of opts.junkMarkers ?? []) parts.push(jm);
	for (const lvl of levels) {
		const flat: number[] = [];
		for (const [lo, hi] of lvl.pairs) {
			flat.push(lo, hi);
		}
		const header = Buffer.alloc(MARKER.length + 8);
		header.write(MARKER, 0, 'ascii');
		header.writeUInt32LE(lvl.levelIndex, MARKER.length);
		header.writeUInt32LE(flat.length, MARKER.length + 4);
		const body = Buffer.alloc(flat.length * 2);
		for (let i = 0; i < flat.length; i++) {
			body.writeUInt16LE(floatToHalf(flat[i]), i * 2);
		}
		parts.push(header, body);
	}
	if (opts.suffix) parts.push(opts.suffix);
	return Buffer.concat(parts);
}

// Round-trip helper: JS has no native float16 writer. Encode via the
// standard round-to-nearest-even path so fixture values match what the
// parser decodes. Adequate for the small, exactly-representable test
// values used here.
function floatToHalf(val: number): number {
	if (val === 0) return 0;
	const sign = val < 0 ? 0x8000 : 0;
	let v = Math.abs(val);
	if (!Number.isFinite(v)) return sign | 0x7c00;
	let exp = Math.floor(Math.log2(v));
	let mant = v / 2 ** exp - 1; // in [0, 1)
	// Clamp exponent to the normal range for our test values.
	let e = exp + 15;
	if (e <= 0) {
		// Subnormal: encode as frac * 2^-24.
		const frac = Math.round(v / 2 ** -24);
		return sign | (frac & 0x03ff);
	}
	if (e >= 0x1f) return sign | 0x7c00; // inf
	let frac = Math.round(mant * 1024);
	if (frac === 1024) {
		frac = 0;
		e += 1;
	}
	return sign | (e << 10) | (frac & 0x03ff);
}

describe('parseAsdOverview', () => {
	it('extracts min/max pairs from a single overview level', () => {
		const pairs: [number, number][] = [
			[-1.0, 0.5],
			[-0.5, 0.9995],
			[-0.25, 0.25],
			[0.0, 0.0]
		];
		const buf = buildAsd([{ levelIndex: 0, pairs }]);
		const out = parseAsdOverview(buf, 4);
		expect(out).not.toBeNull();
		expect(out!.sourceBins).toBe(4);
		expect(out!.peaks).toHaveLength(4);
		// Values decode back to (near) the encoded amplitudes.
		out!.peaks.forEach(([lo, hi], i) => {
			expect(lo).toBeCloseTo(pairs[i][0], 2);
			expect(hi).toBeCloseTo(pairs[i][1], 2);
			expect(lo).toBeLessThanOrEqual(hi);
		});
	});

	it('picks the highest-resolution level when multiple are present', () => {
		const coarse: [number, number][] = [
			[-0.9, 0.9],
			[-0.8, 0.8]
		];
		const fine: [number, number][] = Array.from({ length: 100 }, (_, i) => [
			-((i % 10) / 10),
			(i % 10) / 10
		]);
		const buf = buildAsd([
			{ levelIndex: 1, pairs: coarse },
			{ levelIndex: 0, pairs: fine }
		]);
		const out = parseAsdOverview(buf, 100);
		expect(out).not.toBeNull();
		expect(out!.sourceBins).toBe(100); // the fine level won
	});

	it('downsamples to the requested bin count via min-of-mins / max-of-maxes', () => {
		// 8 source pairs -> 2 output bins: bin 0 covers pairs 0-3, bin 1 pairs 4-7.
		const pairs: [number, number][] = [
			[-0.1, 0.1],
			[-0.9, 0.2], // deepest min in first half
			[-0.3, 0.8], // highest max in first half
			[-0.2, 0.3],
			[-0.4, 0.4],
			[-0.7, 0.5],
			[-0.6, 0.95], // highest max in second half
			[-0.95, 0.6] // deepest min in second half
		];
		const buf = buildAsd([{ levelIndex: 0, pairs }]);
		const out = parseAsdOverview(buf, 2);
		expect(out).not.toBeNull();
		const [b0, b1] = out!.peaks;
		expect(b0[0]).toBeCloseTo(-0.9, 2);
		expect(b0[1]).toBeCloseTo(0.8, 2);
		expect(b1[0]).toBeCloseTo(-0.95, 2);
		expect(b1[1]).toBeCloseTo(0.95, 2);
	});

	it('ignores schema-header marker hits (junk/out-of-range values)', () => {
		// A stray marker followed by a large count that would run past EOF,
		// plus a marker whose "values" are out of the [-1,1] amplitude range.
		const junkBigCount = Buffer.concat([
			Buffer.from(MARKER, 'ascii'),
			(() => {
				const b = Buffer.alloc(8);
				b.writeUInt32LE(0, 0);
				b.writeUInt32LE(0xffffff, 4); // count that overruns the file
				return b;
			})()
		]);
		const real: [number, number][] = [
			[-0.5, 0.5],
			[-0.3, 0.3]
		];
		const buf = buildAsd([{ levelIndex: 0, pairs: real }], {
			junkMarkers: [junkBigCount]
		});
		const out = parseAsdOverview(buf, 2);
		expect(out).not.toBeNull();
		expect(out!.sourceBins).toBe(2); // only the real level survived
	});

	it('returns null when no overview level is present', () => {
		const buf = Buffer.from('not an asd file, no marker here', 'ascii');
		expect(parseAsdOverview(buf, 256)).toBeNull();
	});

	it('rejects a level with an odd value count (not min/max pairs)', () => {
		// count=3 is odd -> not valid pairs -> skipped.
		const header = Buffer.alloc(MARKER.length + 8);
		header.write(MARKER, 0, 'ascii');
		header.writeUInt32LE(0, MARKER.length);
		header.writeUInt32LE(3, MARKER.length + 4);
		const body = Buffer.alloc(6); // 3 float16s
		const buf = Buffer.concat([header, body]);
		expect(parseAsdOverview(buf, 256)).toBeNull();
	});
});

// Integration check against a real Ableton pack `.asd` when available on
// this machine. Skipped in CI / on machines without the pack installed,
// so the suite stays hermetic — the synthetic cases above are the
// contract. This one guards against real-world drift (Live version
// changes to the block layout).
const REAL_ASD =
	'/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/Packs/Chop and Swing/' +
	'Samples/Loops and Chords/Drum Loops/Full Loops/LL Loop 79 BPM.aif.asd';

describe.runIf(existsSync(REAL_ASD))('parseAsdOverview (real fixture)', () => {
	it('decodes the LL Loop 79 BPM overview to a clean 256-bin envelope', () => {
		const data = readFileSync(REAL_ASD);
		const out = parseAsdOverview(data, 256);
		expect(out).not.toBeNull();
		expect(out!.peaks).toHaveLength(256);
		// High-res source level for this ~7s loop is ~2094 bins.
		expect(out!.sourceBins).toBeGreaterThan(1000);
		// Every pair is a valid, in-range min<=max amplitude.
		for (const [lo, hi] of out!.peaks) {
			expect(lo).toBeGreaterThanOrEqual(-1.06);
			expect(hi).toBeLessThanOrEqual(1.06);
			expect(lo).toBeLessThanOrEqual(hi);
		}
		// A drum loop has real dynamics — not a flat/silent envelope.
		const span = Math.max(...out!.peaks.map(([, hi]) => hi));
		expect(span).toBeGreaterThan(0.3);
	});
});
