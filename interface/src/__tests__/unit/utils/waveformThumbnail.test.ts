import { describe, it, expect } from 'vitest';
import {
	THUMB_BINS,
	THUMB_VERSION,
	encodeThumbnailPeaks,
	decodeThumbnailPeaks,
	isAudioThumbnailType
} from '$lib/utils/waveformThumbnail';

describe('waveformThumbnail codec', () => {
	it('exposes a stable format version and bin count', () => {
		expect(THUMB_BINS).toBe(256);
		expect(THUMB_VERSION).toBeGreaterThanOrEqual(2);
	});

	it('round-trips peaks within 8-bit quantisation tolerance', () => {
		const peaks: [number, number][] = Array.from({ length: THUMB_BINS }, (_, i) => {
			const phase = (i / THUMB_BINS) * Math.PI * 2;
			return [-Math.abs(Math.sin(phase)), Math.abs(Math.cos(phase))] as [number, number];
		});

		const decoded = decodeThumbnailPeaks(encodeThumbnailPeaks(peaks));
		expect(decoded).not.toBeNull();
		expect(decoded!.length).toBe(THUMB_BINS);

		// 1/127 is the quantisation step; allow a hair over half a step of error.
		const tolerance = 1 / 127 + 1e-9;
		for (let i = 0; i < THUMB_BINS; i++) {
			expect(Math.abs(decoded![i][0] - peaks[i][0])).toBeLessThanOrEqual(tolerance);
			expect(Math.abs(decoded![i][1] - peaks[i][1])).toBeLessThanOrEqual(tolerance);
		}
	});

	it('clamps out-of-range values to ±1 instead of wrapping', () => {
		const decoded = decodeThumbnailPeaks(encodeThumbnailPeaks([[-2.5, 3.9]]));
		expect(decoded).not.toBeNull();
		// 127/127 === 1. Must clamp, never wrap to a negative via int8 overflow.
		expect(decoded![0][0]).toBeCloseTo(-1, 5);
		expect(decoded![0][1]).toBeCloseTo(1, 5);
	});

	it('produces a compact string (~684 chars for 256 bins)', () => {
		const peaks: [number, number][] = Array.from({ length: THUMB_BINS }, () => [-0.5, 0.5]);
		const encoded = encodeThumbnailPeaks(peaks);
		// 512 bytes → ceil(512/3)*4 = 684 base64 chars.
		expect(encoded.length).toBe(684);
	});

	it('zero-pads short input and ignores extra bins', () => {
		const short = encodeThumbnailPeaks([[0.5, 0.6]]);
		const decodedShort = decodeThumbnailPeaks(short);
		expect(decodedShort!.length).toBe(THUMB_BINS);
		expect(decodedShort![1]).toEqual([0, 0]);

		const long: [number, number][] = Array.from({ length: THUMB_BINS + 20 }, () => [-0.1, 0.1]);
		const decodedLong = decodeThumbnailPeaks(encodeThumbnailPeaks(long));
		expect(decodedLong!.length).toBe(THUMB_BINS);
	});

	it('returns null for empty / garbage input', () => {
		expect(decodeThumbnailPeaks('')).toBeNull();
		expect(decodeThumbnailPeaks(undefined)).toBeNull();
		expect(decodeThumbnailPeaks(null)).toBeNull();
	});

	it('gates rendering on audio extensions only', () => {
		expect(isAudioThumbnailType('.wav')).toBe(true);
		expect(isAudioThumbnailType('.AIFF')).toBe(true);
		expect(isAudioThumbnailType('.alc')).toBe(true);
		expect(isAudioThumbnailType('.adg')).toBe(false);
		expect(isAudioThumbnailType('.adv')).toBe(false);
		expect(isAudioThumbnailType(undefined)).toBe(false);
	});
});
